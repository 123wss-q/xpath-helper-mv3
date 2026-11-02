// SPDX-License-Identifier: Apache-2.0
// Content protocol checks; background/library and real DOM tests are separate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
let count = 0;
const check = (name, fn) => { fn(); console.log('PASS:', name); count++; };
const sent = [], classes = new Set();
const frame = {classList: {
  add: value => classes.add(value), remove: value => classes.delete(value),
  contains: value => classes.has(value),
  toggle: value => classes.has(value) ? classes.delete(value) : classes.add(value)
}};
let generatorArgs;
const context = {
  location: {origin:'https://shop.example', protocol:'https:'},
  document: {createElement: () => frame, addEventListener() {}, removeEventListener() {},
    querySelectorAll: () => [], body:{appendChild() {}},
    evaluate() { return {resultType: 1, numberValue: 7}; }},
  Node: {ELEMENT_NODE:1, ATTRIBUTE_NODE:2},
  XPathResult: {ANY_TYPE:0, NUMBER_TYPE:1, STRING_TYPE:2, BOOLEAN_TYPE:3},
  window: {setTimeout: fn => fn(), focus() {}},
  chrome: {runtime:{id:'test-extension', getURL: value => 'chrome-extension://test-extension/'+value,
    onMessage:{addListener() {}}, sendMessage:(request, cb) => {sent.push(request); cb();}}},
  xhXPath: {generate: (element, mode) => {generatorArgs={element,mode};return "//*[@id='selected']";}}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'content.js'),'utf8'), context);
const bar = context.window.xhBarInstance, sender = {id:'test-extension'};
check('Initial panel reports empty results and origin', () => {
  bar.handleRequest_({type:'ready'},sender);
  assert.equal(sent.at(-1).query,'');assert.equal(sent.at(-1).meta.kind,'empty');
  assert.equal(sent.at(-1).site,'https://shop.example');
});
check('Untrusted messages cannot modify query or request context', () => {
  let answered=false;
  bar.handleRequest_({type:'evaluate',query:'bad'},{id:'another-extension'});
  bar.handleRequest_({type:'context'},null,()=>{answered=true;});
  assert.equal(bar.query_,''); assert.equal(answered,false);
});
check('Context derives from page origin and groups local files', () => {
  let site;
  bar.handleRequest_({type:'context'},sender,value=>{site=value.site;});
  assert.equal(site,'https://shop.example');
  context.location.protocol='file:';
  bar.handleRequest_({type:'context'},sender,value=>{site=value.site;});
  assert.equal(site,'file://');context.location.protocol='https:';
});
check('Evaluation distinguishes scalars and rejects oversized/nonstring queries', () => {
  bar.handleRequest_({type:'evaluate',query:'count(//li)'},sender);
  assert.equal(sent.at(-1).results[0],'7');assert.equal(sent.at(-1).meta.kind,'number');
  assert.equal(sent.at(-1).query,null);
  bar.handleRequest_({type:'evaluate',query:'x'.repeat(4097)},sender);
  bar.handleRequest_({type:'evaluate',query:{}},sender);
  assert.equal(bar.query_,'count(//li)');
});
check('Mode regenerates current connected element and rejects unknown modes', () => {
  const element={isConnected:true};bar.currEl_=element;
  bar.handleRequest_({type:'mode',mode:'absolute'},sender);
  assert.equal(generatorArgs.element,element);assert.equal(generatorArgs.mode,'absolute');
  assert.equal(sent.at(-1).mode,'absolute');
  bar.handleRequest_({type:'mode',mode:'unknown'},sender);assert.equal(bar.mode_,'absolute');
});
check('Generation failure clears stale query and provides an error', () => {
  context.xhXPath.generate=()=>{throw new Error('detached');};
  bar.updateQueryAndBar_({});
  assert.equal(sent.at(-1).query,'');assert.equal(sent.at(-1).meta.kind,'error');
  assert.equal(sent.at(-1).meta.error,'detached');
});
check('Show, move and hide operate on the panel', () => {
  bar.handleRequest_({type:'toggleBar'},sender);assert.equal(bar.hidden_(),false);
  bar.handleRequest_({type:'moveBar'},sender);assert.equal(classes.has('bottom'),true);
  bar.handleRequest_({type:'hideBar'},sender);assert.equal(bar.hidden_(),true);
});
check('MV3 loads generator first, declares only storage and has all local resources', () => {
  const m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.equal(m.manifest_version,3);assert.equal(m.version,'2.1.0');
  assert.deepEqual(m.permissions,['storage']);assert.deepEqual(m.content_scripts[0].js,['xpath.js','content.js']);
  assert.ok(!m.update_url && !m.browser_action && !m.background.page);
  const files=[m.background.service_worker,'library.js',...Object.values(m.icons),
    ...Object.values(m.action.default_icon),...m.content_scripts.flatMap(x=>[...x.js,...x.css]),
    ...m.web_accessible_resources.flatMap(x=>x.resources)];
  for(const file of files) assert.ok(fs.existsSync(path.join(root,file)),file);
});
console.log(`${count} content protocol/resource checks passed.`);
