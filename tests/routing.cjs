// SPDX-License-Identifier: Apache-2.0
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); console.log('PASS:', name); };
const id = 'test-extension';
const getURL = file => `chrome-extension://${id}/${file}`;
let relayListener, actionListener;
let sent = [];
const chrome = {
  runtime: {id, getURL, onMessage: {addListener: fn => { relayListener = fn; }}},
  tabs: {sendMessage: (tabId, request, options, cb) => { sent.push({tabId, request, options}); cb(); }},
  action: {onClicked: {addListener: fn => { actionListener = fn; }}}
};
vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), {chrome});
check('Service worker registers message and toolbar listeners synchronously', () => {
  assert.equal(typeof relayListener, 'function'); assert.equal(typeof actionListener, 'function');
});
const sender = {id, url: getURL('bar.html'), tab: {id: 12}, frameId: 3};
check('Panel commands reach only their own top-level tab', () => {
  for (const type of ['ready', 'evaluate', 'moveBar', 'hideBar']) relayListener({type}, sender);
  assert.equal(sent.length, 4);
  assert.ok(sent.every(x => x.tabId === 12 && x.options.frameId === 0));
});
check('Updates, unexpected commands and invalid senders are not relayed', () => {
  const before = sent.length;
  for (const type of ['update', 'toggleBar', 'unknown']) relayListener({type}, sender);
  relayListener({type: 'evaluate'}, {...sender, id: 'another-extension'});
  relayListener({type: 'evaluate'}, {...sender, url: 'https://example.test'});
  relayListener({type: 'evaluate'}, {id});
  assert.equal(sent.length, before);
});
check('Toolbar click targets one tab and tolerates a missing receiver', () => {
  chrome.runtime.lastError = {message: 'Receiving end does not exist'};
  actionListener({id: 17}); actionListener({});
  assert.equal(sent.at(-1).tabId, 17);
  assert.equal(sent.at(-1).request.type, 'toggleBar');
  chrome.runtime.lastError = undefined;
});

function panel(tabId) {
  const messages = [], events = {}, dom = {};
  const node = () => ({value: '', children: [], addEventListener(type, fn) { this[type] = fn; },
    appendChild(child) { this.children.push(child); }});
  for (const name of ['query', 'results', 'node-count']) dom[name] = node();
  let listener;
  const context = {
    document: {getElementById: key => dom[key], createTextNode: text => ({nodeValue: text}),
      addEventListener: (name, fn) => {events[name] = fn;}},
    chrome: {runtime: {id, onMessage: {addListener: fn => {listener = fn;}},
      sendMessage: value => {assert.equal(typeof listener, 'function'); messages.push(value);}},
      tabs: {getCurrent: cb => cb({id: tabId})}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'bar.js'), 'utf8'), context);
  return {messages, events, dom, receive: (...args) => listener(...args)};
}
const a = panel(12), b = panel(17);
check('Panel ready message is sent after listeners and tab ID are initialized', () => {
  assert.equal(a.messages[0].type, 'ready');
});
check('Query results remain isolated between two tabs', () => {
  const request = {type: 'update', query: '//li', results: ['Apple\nBanana', 2]};
  const fromPage = {id, tab: {id: 12}, frameId: 0};
  a.receive(request, fromPage); b.receive(request, fromPage);
  assert.equal(a.dom.results.value, 'Apple\nBanana');
  assert.equal(a.dom['node-count'].children[0].nodeValue, 2);
  assert.equal(b.dom.results.value, '');
  a.receive({...request, results: ['WRONG', 1]}, {...fromPage, frameId: 5});
  assert.equal(a.dom.results.value, 'Apple\nBanana');
});
check('Input changes and iframe shortcut send the expected commands', () => {
  a.dom.query.value = 'count(//li)'; a.dom.query.input();
  assert.equal(a.messages.at(-1).query, 'count(//li)');
  assert.equal(a.messages.at(-1).type, 'evaluate');
  a.events.keydown({ctrlKey: true, shiftKey: true, keyCode: 88});
  assert.equal(a.messages.at(-1).type, 'hideBar');
});
const contentContext = {location: {href: 'https://acid3.acidtests.org/'},
  document: {createElement: () => ({classList: {add() {}}}), addEventListener() {}},
  chrome: {runtime: {getURL, onMessage: {addListener() {}}}}};
vm.createContext(contentContext);
vm.runInContext(fs.readFileSync(path.join(root, 'content.js'), 'utf8'), contentContext);
check('Content script initializes an empty query and resends state on ready', () => {
  const bar = new contentContext.xh.Bar();
  assert.equal(bar.query_, '');
  let refreshed = false;
  bar.updateBar_ = updateQuery => {refreshed = updateQuery;};
  bar.handleRequest_({type: 'ready'});
  assert.equal(refreshed, true);
});
check('Manifest uses MV3 and every declared local entry exists', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.equal(m.manifest_version, 3); assert.ok(m.action);
  assert.equal(m.background.service_worker, 'background.js');
  assert.ok(!m.update_url && !m.browser_action && !m.background.page);
  assert.ok(!fs.existsSync(path.join(root, '_metadata')));
  const files = [m.background.service_worker, ...Object.values(m.icons),
    ...Object.values(m.action.default_icon), ...m.content_scripts.flatMap(x => [...x.js, ...x.css]),
    ...m.web_accessible_resources.flatMap(x => x.resources)];
  for (const file of files) assert.ok(fs.existsSync(path.join(root, file)), file);
});
console.log(`${checks.length} checks passed (mock Chrome/DOM APIs).`);
