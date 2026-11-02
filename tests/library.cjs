// SPDX-License-Identifier: Apache-2.0
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'library.js'), 'utf8');
const context = vm.createContext({URL, TextEncoder, crypto: webcrypto});
vm.runInContext(source, context);
const {create, normalizeSite, limits} = context.XHLibrary;
const copy = value => value === undefined ? value : JSON.parse(JSON.stringify(value));
const cases = [];
const test = (name, run) => cases.push({name, run});

function memory(initial) {
  let value = copy(initial), writes = 0, fail = false;
  const library = create({
    async get() { await Promise.resolve(); return copy(value); },
    async set(next) {
      await Promise.resolve();
      if (fail) { fail = false; throw new Error('disk full'); }
      value = copy(next); writes++;
    }
  });
  return {library, get data() { return copy(value); }, get writes() { return writes; },
    failNextWrite() { fail = true; }};
}

test('Only HTTP(S) origins and the explicit local-file scope are accepted', () => {
  assert.equal(normalizeSite('https://EXAMPLE.test:443/private?token=hidden'), 'https://example.test');
  assert.equal(normalizeSite('http://example.test:8080/page'), 'http://example.test:8080');
  assert.equal(normalizeSite('file://'), 'file://');
  for (const site of ['', null, 'null', 'data:text/html,x', 'chrome://settings', 'https://u:p@example.test']) {
    assert.throws(() => normalizeSite(site));
  }
});

test('Listing an empty site does not write a database or create a site', async () => {
  const m = memory();
  const result = await m.library.run('https://a.test', {action: 'list'});
  assert.equal(result.site, 'https://a.test');
  assert.equal(result.history.length, 0);
  assert.equal(m.writes, 0);
});

test('History is deduplicated, bounded, and grouped by origin', async () => {
  const m = memory();
  for (let i = 0; i < 35; i++) await m.library.run('https://a.test', {action: 'remember', query: '//li[' + i + ']'});
  const first = await m.library.run('https://a.test', {action: 'list'});
  const oldest = first.history.at(-1).query;
  const kept = first.history[10];
  const result = await m.library.run('https://a.test', {action: 'remember', query: '  ' + kept.query + ' '});
  assert.equal(result.history.length, 30);
  assert.equal(result.history[0].id, kept.id);
  assert.equal(result.history[0].query, kept.query);
  assert.ok(result.history.some(entry => entry.query === oldest));
  assert.equal((await m.library.run('http://a.test', {action: 'list'})).history.length, 0);
  assert.equal((await m.library.run('https://b.test', {action: 'list'})).history.length, 0);
  assert.ok(!JSON.stringify(m.data).includes('private?token'));
});

test('Concurrent changes from multiple tabs retain all accepted queries and sites', async () => {
  const m = memory();
  await Promise.all(Array.from({length: 24}, (_, i) =>
    m.library.run('https://site' + (i % 3) + '.test', {action: 'remember', query: '//item[' + i + ']'})));
  for (let i = 0; i < 3; i++) {
    const result = await m.library.run('https://site' + i + '.test', {action: 'list'});
    assert.equal(result.history.length, 8);
  }
});

test('Favorites support stable IDs, renaming and a hard non-evicting limit', async () => {
  const m = memory();
  const one = await m.library.run('https://a.test', {action: 'favorite', query: '//a', name: '链接'});
  const again = await m.library.run('https://a.test', {action: 'favorite', query: '//a', name: '新名字'});
  assert.equal(again.favorites.length, 1);
  assert.equal(again.favorites[0].id, one.favorites[0].id);
  assert.equal(again.favorites[0].name, '新名字');
  for (let i = 1; i < 50; i++) await m.library.run('https://a.test', {action: 'favorite', query: '//a[' + i + ']'});
  await assert.rejects(m.library.run('https://a.test', {action: 'favorite', query: '//extra'}), /50/);
  const saved = await m.library.run('https://a.test', {action: 'list'});
  assert.equal(saved.favorites.length, 50);
  assert.ok(saved.favorites.some(entry => entry.id === one.favorites[0].id));
});

test('Remove and clear actions affect only the requested collection and origin', async () => {
  const m = memory();
  for (const site of ['https://a.test', 'https://b.test']) {
    await m.library.run(site, {action: 'favorite', query: '//a'});
    await m.library.run(site, {action: 'remember', query: '//b'});
  }
  let result = await m.library.run('https://a.test', {action: 'clear-history'});
  assert.equal(result.history.length, 0);
  assert.equal(result.favorites.length, 1);
  result = await m.library.run('https://a.test', {action: 'remove', id: result.favorites[0].id});
  assert.equal(result.favorites.length, 0);
  assert.ok(!Object.hasOwn(m.data.sites, 'https://a.test'));
  result = await m.library.run('https://b.test', {action: 'clear-favorites'});
  assert.equal(result.favorites.length, 0);
  assert.equal(result.history.length, 1);
});

test('Invalid input is rejected before writing and does not stall the queue', async () => {
  const m = memory();
  for (const request of [
    {action: 'remember', query: ''}, {action: 'favorite', query: 'x'.repeat(4097)},
    {action: 'favorite', query: '//a', name: 'x'.repeat(81)}, {action: 'remove', id: ''},
    {action: 'unknown'}
  ]) await assert.rejects(m.library.run('https://a.test', request));
  assert.equal(m.writes, 0);
  const result = await m.library.run('https://a.test', {action: 'remember', query: '//a'});
  assert.equal(result.history.length, 1);
});

test('Failed storage writes leave previous data intact and later operations recover', async () => {
  const m = memory();
  await m.library.run('https://a.test', {action: 'favorite', query: '//saved'});
  const previous = m.data;
  m.failNextWrite();
  await assert.rejects(m.library.run('https://a.test', {action: 'clear-favorites'}), /disk full/);
  assert.deepEqual(m.data, previous);
  assert.equal((await m.library.run('https://a.test', {action: 'remember', query: '//next'})).favorites.length, 1);
});

test('Site-limit eviction removes old history-only sites and keeps favorites', async () => {
  const m = memory();
  await m.library.run('https://favorite.test', {action: 'favorite', query: '//saved'});
  for (let i = 0; i < 105; i++) {
    await m.library.run('https://s' + i + '.test', {action: 'remember', query: '//a'});
  }
  assert.equal(Object.keys(m.data.sites).length, 100);
  assert.ok(m.data.sites['https://favorite.test']);
  assert.ok(!m.data.sites['https://s0.test']);
  assert.ok(m.data.sites['https://s104.test']);
});

test('A full set of favorite-bearing sites is not silently deleted for a new site', async () => {
  const m = memory();
  for (let i = 0; i < 100; i++) {
    await m.library.run('https://s' + i + '.test', {action: 'favorite', query: '//a'});
  }
  const previous = m.data;
  await assert.rejects(m.library.run('https://new.test', {action: 'remember', query: '//new'}), /100/);
  assert.deepEqual(m.data, previous);
});

test('The byte limit accounts for UTF-8 and never silently drops saved favorites', async () => {
  const database = {version: 1, sites: {}};
  let count = 0;
  while (Buffer.byteLength(JSON.stringify(database)) < limits.bytes - 13000) {
    const site = 'https://s' + Math.floor(count / 50) + '.test';
    const saved = database.sites[site] ||= {history: [], favorites: [], updatedAt: 1};
    saved.favorites.push({id: 'entry-' + count, query: '汉'.repeat(4090) + count,
      name: '', createdAt: 1});
    count++;
  }
  const m = memory(database);
  // At least two large additions cross the remaining byte allowance.
  let rejected = false;
  for (let i = 0; i < 3; i++) {
    try { await m.library.run('https://large.test', {action: 'favorite', query: '汉'.repeat(4090) + 'new' + i}); }
    catch (error) { assert.match(error.message, /空间/); rejected = true; break; }
  }
  assert.ok(rejected);
  assert.ok(Buffer.byteLength(JSON.stringify(m.data)) <= limits.bytes);
  for (const [site, saved] of Object.entries(database.sites)) assert.deepEqual(m.data.sites[site], saved);
});

test('Corrupt stored data is reported without resetting or overwriting it', async () => {
  const m = memory({version: 1, sites: {'https://a.test': {history: null}}});
  await assert.rejects(m.library.run('https://a.test', {action: 'remember', query: '//a'}), /格式异常/);
  assert.equal(m.writes, 0);
});

function backgroundHarness() {
  let listener, toolbar, value;
  const calls = [], storageCalls = [];
  const sites = {1: 'https://a.test/private?secret=never-store', 2: 'https://b.test', 3: null};
  const runtime = {id: 'test-extension', getURL: file => 'chrome-extension://test-extension/' + file,
    onMessage: {addListener(fn) { listener = fn; }}};
  const chrome = {runtime,
    storage: {local: {
      get(key, callback) { storageCalls.push('get'); queueMicrotask(() => callback({[key]: copy(value)})); },
      set(next, callback) { storageCalls.push('set'); value = copy(next.xpathHelperLibraryV1); queueMicrotask(callback); },
      setAccessLevel(options) { assert.equal(options.accessLevel, 'TRUSTED_CONTEXTS'); return Promise.resolve(); }
    }},
    tabs: {sendMessage(tabId, request, options, callback) {
      calls.push({tabId, request, options});
      queueMicrotask(() => callback(request.type === 'context' && sites[tabId] ? {site: sites[tabId]} : undefined));
    }},
    action: {onClicked: {addListener(fn) { toolbar = fn; }}}
  };
  const sandbox = vm.createContext({chrome, URL, TextEncoder, crypto: webcrypto});
  sandbox.importScripts = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), sandbox);
  const sender = {id: runtime.id, url: runtime.getURL('bar.html'), tab: {id: 1}, frameId: 3};
  return {calls, storageCalls, sender, get data() { return copy(value); },
    receive(request, from = sender, callback = () => {}) { return listener(request, from, callback); },
    async library(request, from = sender) { return new Promise(resolve => listener({type: 'library', ...request}, from, resolve)); },
    click(tab) { toolbar(tab); }};
}

test('Background rejects forged senders without touching storage or the page', () => {
  const h = backgroundHarness();
  for (const sender of [
    {...h.sender, id: 'another-extension'}, {...h.sender, url: 'https://evil.test'},
    {...h.sender, tab: undefined}, {...h.sender, tab: {id: '1'}}
  ]) assert.equal(h.receive({type: 'library', action: 'list'}, sender), undefined);
  assert.equal(h.calls.length, 0);
  assert.equal(h.storageCalls.length, 0);
});

test('Background derives the site from its own tab, ignoring a caller-supplied site', async () => {
  const h = backgroundHarness();
  const a = await h.library({action: 'remember', query: '//a', site: 'https://evil.test'});
  assert.equal(a.site, 'https://a.test');
  assert.equal(a.history.length, 1);
  const b = await h.library({action: 'list'}, {...h.sender, tab: {id: 2}});
  assert.equal(b.history.length, 0);
  assert.ok(h.calls.every(call => call.options.frameId === 0));
  assert.ok(!JSON.stringify(h.data).includes('secret'));
  assert.ok(!JSON.stringify(h.data).includes('evil'));
});

test('Incognito and missing-content-script requests return errors without persistence', async () => {
  const h = backgroundHarness();
  const privateResult = await h.library({action: 'remember', query: '//secret'}, {...h.sender, tab: {id: 1, incognito: true}});
  assert.equal(privateResult.ok, false);
  assert.match(privateResult.error, /隐身/);
  assert.equal(h.calls.length, 0);
  const unavailable = await h.library({action: 'favorite', query: '//x'}, {...h.sender, tab: {id: 3}});
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.error, /刷新/);
  assert.equal(h.storageCalls.length, 0);
});

test('Navigation races cannot save, clear, or expose records under a new site', async () => {
  const h = backgroundHarness();
  await h.library({action: 'favorite', query: '//existing', expectedSite: 'https://a.test'});
  const before = h.data;
  const beforeCalls = h.storageCalls.length;
  for (const action of ['list', 'remember', 'favorite', 'clear-history', 'clear-favorites']) {
    const result = await h.library({action, query: '//old-page', expectedSite: 'https://old.test'});
    assert.equal(result.ok, false);
    assert.match(result.error, /网页已切换/);
  }
  assert.deepEqual(h.data, before);
  assert.equal(h.storageCalls.length, beforeCalls);
  const correct = await h.library({action: 'list', expectedSite: 'https://a.test'});
  assert.equal(correct.ok, true);
  assert.equal(correct.favorites[0].query, '//existing');
});

test('Toolbar and allowed mode commands are routed only to the top-level target tab', async () => {
  const h = backgroundHarness();
  h.receive({type: 'mode', mode: 'absolute'});
  h.click({id: 2});
  h.receive({type: 'unknown'});
  await Promise.resolve();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].request.type, 'mode');
  assert.equal(h.calls[0].tabId, 1);
  assert.equal(h.calls[1].request.type, 'toggleBar');
  assert.equal(h.calls[1].tabId, 2);
  assert.ok(h.calls.every(call => call.options.frameId === 0));
});

test('All accepted panel commands receive an explicit acknowledgement', () => {
  const h = backgroundHarness();
  for (const type of ['ready', 'evaluate', 'mode', 'moveBar', 'hideBar']) {
    let response;
    h.receive({type, query: '//a', mode: 'smart'}, h.sender, value => { response = value; });
    assert.equal(response && response.ok, true, type);
  }
});

(async function() {
  for (const item of cases) {
    await item.run();
    console.log('PASS:', item.name);
  }
  console.log(cases.length + ' library and background checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
