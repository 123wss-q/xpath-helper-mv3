// SPDX-License-Identifier: Apache-2.0
// Panel behavior checks with simulated Chrome, DOM and clipboard APIs.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const ids = [...fs.readFileSync(path.join(root, 'bar.html'), 'utf8').matchAll(/id="([^"]+)"/g)].map(x => x[1]);
const flush = () => new Promise(resolve => setImmediate(resolve));

function makePanel(incognito = false) {
  let listener, timerId = 0;
  const clipboard = [], messages = [], pending = [], timers = new Map(), events = {}, dom = {};
  const document = {
    activeElement: null,
    getElementById: key => dom[key],
    createElement: tag => element(tag),
    addEventListener: (type, fn) => { events[type] = fn; },
    execCommand: () => false
  };
  const element = tag => ({
    tag, value: '', textContent: '', title: '', disabled: false, hidden: false,
    children: [], dataset: {}, attributes: {}, listeners: {}, selectionStart: 0, selectionEnd: 0,
    addEventListener(type, fn) { this.listeners[type] = fn; },
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    setAttribute(name, value) { this.attributes[name] = value; },
    focus() { document.activeElement = this; },
    select() { this.selectionStart = 0; this.selectionEnd = this.value.length; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  });
  for (const id of ids) dom[id] = element('node');
  dom['library-panel'].hidden = true;
  const context = {
    document,
    navigator: {clipboard: {writeText: text => { clipboard.push(text); return Promise.resolve(); }}},
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    chrome: {
      runtime: {
        id: 'test-extension',
        onMessage: {addListener: fn => { listener = fn; }},
        sendMessage: (request, callback) => {
          messages.push(request);
          if (request.type === 'library') pending.push({request, callback});
          else if (callback) callback();
        }
      },
      tabs: {getCurrent: cb => cb({id: 12, incognito})}
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'bar.js'), 'utf8'), context);
  const receive = (request, sender = {}) => listener(request, {
    id: 'test-extension', tab: {id: 12}, frameId: 0, ...sender
  });
  const update = (site = 'https://a.example', query = '//a', extra = {}, sender = {}) => receive({
    type: 'update', query, evaluatedQuery: query, results: ['item', 1],
    meta: {kind: 'nodes'}, site, mode: 'smart', ...extra
  }, sender);
  return {context, dom, events, messages, pending, timers, clipboard, update, receive};
}

function readyPanel(incognito = false) {
  const panel = makePanel(incognito);
  panel.update();
  if (!incognito) panel.pending.shift().callback({ok: true, site: 'https://a.example', history: [], favorites: []});
  return panel;
}

let checks = 0;
async function check(name, fn) {
  await fn();
  checks++;
  console.log('PASS:', name);
}

async function main() {
  await check('Ready initializes the panel, match status and expected-site library request', () => {
    const p = makePanel();
    assert.equal(p.messages[0].type, 'ready');
    p.update();
    assert.equal(p.dom.query.value, '//a');
    assert.equal(p.dom['match-status'].textContent, '唯一匹配');
    assert.equal(p.pending[0].request.action, 'list');
    assert.equal(p.pending[0].request.expectedSite, 'https://a.example');
  });

  await check('Other tabs, frames and extension IDs cannot overwrite the panel', () => {
    const p = readyPanel();
    for (const sender of [{tab: {id: 13}}, {frameId: 2}, {id: 'another-extension'}]) {
      p.update('https://a.example', '//wrong', {}, sender);
      assert.equal(p.dom.query.value, '//a');
    }
  });

  await check('Stored queries are rendered as text, and restoring one does not add history', () => {
    const p = makePanel();
    p.update();
    p.pending.shift().callback({ok: true, site: 'https://a.example', history: [{id: 'h', query: '<img src=x>', name: ''}], favorites: []});
    const restore = p.dom['history-list'].children[0].children[0];
    assert.equal(restore.children[0].textContent, '<img src=x>');
    restore.listeners.click();
    assert.equal(p.dom.query.value, '<img src=x>');
    assert.equal(p.messages.at(-1).type, 'evaluate');
    assert.equal(p.pending.length, 0);
  });

  await check('Picking another element cancels the pending typing evaluation', () => {
    const p = readyPanel();
    p.dom.query.value = '//typing';
    p.dom.query.listeners.input();
    assert.equal(p.timers.size, 1);
    p.update('https://a.example', '//picked');
    assert.equal(p.timers.size, 0);
    assert.equal(p.dom.query.value, '//picked');
  });

  await check('An outdated evaluatedQuery cannot replace results while typing a new query', () => {
    const p = readyPanel();
    p.dom.query.value = '//new-query';
    p.dom.query.listeners.input();
    p.update('https://a.example', null, {evaluatedQuery: '//a', results: ['stale', 7]});
    assert.equal(p.dom.query.value, '//new-query');
    assert.equal(p.dom.results.value, 'item');
    assert.equal(p.dom['node-count'].textContent, '1');
    assert.equal(p.dom['match-status'].textContent, '正在查询…');
    assert.equal(p.dom['copy-results'].disabled, true);
    p.update('https://a.example', null, {evaluatedQuery: '//new-query', results: ['fresh', 2]});
    assert.equal(p.dom.results.value, 'fresh');
    assert.equal(p.dom['node-count'].textContent, '2');
    assert.equal(p.dom['match-status'].textContent, '匹配 2 项');
  });

  await check('Copying XPath records only the copied query, with its expected site', async () => {
    const p = readyPanel();
    p.dom['copy-query'].listeners.click();
    await flush();
    assert.equal(p.clipboard[0], '//a');
    assert.equal(p.pending[0].request.action, 'remember');
    assert.equal(p.pending[0].request.query, '//a');
    assert.equal(p.pending[0].request.expectedSite, 'https://a.example');
    assert.equal(Object.hasOwn(p.pending[0].request, 'results'), false);
  });

  await check('Copying result text never stores it in history', async () => {
    const p = readyPanel();
    p.dom['copy-results'].listeners.click();
    await flush();
    assert.equal(p.clipboard[0], 'item');
    assert.equal(p.pending.length, 0);
  });

  await check('A delayed library response from a previous site is discarded', () => {
    const p = makePanel();
    p.update();
    const stale = p.pending.shift();
    p.update('https://b.example', '//new-site');
    stale.callback({ok: true, site: 'https://a.example', history: [{query: '//secret'}], favorites: []});
    assert.equal(p.dom['history-list'].children[0].textContent, '正在读取当前网站记录…');
    p.pending.shift().callback({ok: true, site: 'https://b.example', history: [], favorites: []});
    assert.equal(p.dom['site-label'].textContent, 'https://b.example');
    assert.equal(p.dom['clear-history'].disabled, true);
  });

  await check('Clearing history needs a second click and targets the current site', () => {
    const p = makePanel();
    p.update();
    p.pending.shift().callback({ok: true, site: 'https://a.example', history: [{id: 'h', query: '//a'}], favorites: []});
    p.dom['clear-history'].listeners.click();
    assert.equal(p.pending.length, 0);
    assert.equal(p.dom['clear-history'].textContent, '确认清空');
    p.dom['clear-history'].listeners.click();
    assert.equal(p.pending[0].request.action, 'clear-history');
    assert.equal(p.pending[0].request.expectedSite, 'https://a.example');
  });

  await check('Clipboard denial selects text for manual copying and adds no history', async () => {
    const p = readyPanel();
    p.context.navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
    p.dom['copy-query'].listeners.click();
    await flush();
    assert.ok(p.dom.notice.textContent.includes('Ctrl / Command + C'));
    assert.equal(p.context.document.activeElement, p.dom.query);
    assert.equal(p.dom.query.selectionEnd, p.dom.query.value.length);
    assert.equal(p.pending.length, 0);
  });

  await check('Clipboard failure after text changes preserves and selects the current text', async () => {
    const p = readyPanel();
    let rejectCopy;
    let legacyCopyCalls = 0;
    p.context.navigator.clipboard.writeText = () => new Promise((resolve, reject) => { rejectCopy = reject; });
    p.context.document.execCommand = () => { legacyCopyCalls++; return true; };
    p.dom['copy-query'].listeners.click();
    p.update('https://a.example', '//different-element');
    rejectCopy(new Error('denied'));
    await flush();
    assert.equal(p.dom.query.value, '//different-element');
    assert.equal(p.context.document.activeElement, p.dom.query);
    assert.equal(p.dom.query.selectionStart, 0);
    assert.equal(p.dom.query.selectionEnd, '//different-element'.length);
    assert.equal(legacyCopyCalls, 0);
    assert.ok(p.dom.notice.textContent.includes('内容已更新'));
    assert.equal(p.pending.length, 0);
  });

  await check('Mode changes route to the page, and incognito mode avoids library reads and writes', () => {
    const p = readyPanel();
    p.dom.mode.value = 'absolute';
    p.dom.mode.listeners.change();
    assert.equal(p.messages.at(-1).mode, 'absolute');
    const privatePanel = readyPanel(true);
    assert.equal(privatePanel.pending.length, 0);
    assert.equal(privatePanel.dom['save-favorite'].disabled, true);
    privatePanel.dom['run-query'].listeners.click();
    assert.equal(privatePanel.messages.at(-1).type, 'evaluate');
    assert.equal(privatePanel.pending.length, 0);
  });

  console.log(`${checks} panel checks passed (simulated browser APIs).`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
