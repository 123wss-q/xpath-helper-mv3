// SPDX-License-Identifier: Apache-2.0
// Integration checks use an isolated browser profile and local fixture only.
// Install playwright-core separately; point PLAYWRIGHT_MODULE_PATH to its package directory.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {randomUUID} = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const argumentsByName = {};
for (let i = 2; i < process.argv.length; i += 2) argumentsByName[process.argv[i]] = process.argv[i + 1];
const executable = argumentsByName['--browser'] || process.env.BROWSER_EXECUTABLE;
const artifacts = path.resolve(argumentsByName['--artifacts'] || path.join(ROOT, '..', '..', 'work', 'v21-browser'));
const modulePaths = [process.env.PLAYWRIGHT_MODULE_PATH, ROOT, process.cwd()].filter(Boolean);
const {chromium} = require(require.resolve('playwright-core', {paths: modulePaths}));
fs.mkdirSync(artifacts, {recursive: true});
const profile = path.join(artifacts, 'profile-' + randomUUID().slice(0, 8));
const report = {checks: [], console_errors: [], clipboard: 'instrumented sinks; system clipboard unchanged'};
let context, page;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>XPath Helper test</title>
<style>body{font:18px sans-serif;padding:290px 36px 60px;background:#f5f7fa;color:#1b2940}
section{background:white;padding:20px;max-width:700px;border-radius:12px}li{padding:9px}button{padding:10px}</style>
</head><body><h1>XPath Helper · 本地测试页面</h1><section><h2>示例商品</h2>
<ul><li id="apple">Apple</li><li id="banana">Banana</li></ul>
<button id="order" data-testid="place-order">提交订单</button></section></body></html>`;
const server = http.createServer((request, response) => {
  let body = html;
  if (request.url === '/xpath-fixture') {
    body = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'xpath.html'), 'utf8').replace('src="../../xpath.js"', 'src="/xpath.js"');
  } else if (request.url === '/xpath.js') {
    body = fs.readFileSync(path.join(ROOT, 'xpath.js'), 'utf8');
  }
  response.writeHead(200, {'Content-Type': (request.url === '/xpath.js' ? 'application/javascript' : 'text/html') + '; charset=utf-8'});
  response.end(body);
});

function check(name, valid = true) {
  assert.ok(valid, name);
  report.checks.push(name);
  console.log('PASS:', name);
}

async function until(condition, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await condition()) return; } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(label + (lastError ? ': ' + lastError.message : ' (timeout)'));
}

function observe(target) {
  target.on('pageerror', error => report.console_errors.push(error.stack || error.message));
  target.on('console', message => {
    if (message.type() === 'error') report.console_errors.push(message.text());
  });
}

async function launch() {
  const options = {
    headless: true,
    viewport: {width: 1280, height: 1000},
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT,
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking']
  };
  if (executable) options.executablePath = executable;
  context = await chromium.launchPersistentContext(profile, options);
  context.setDefaultTimeout(12000);
  context.on('page', observe);
  for (const target of context.pages()) observe(target);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  report.extension_id = worker.url().split('/')[2];
  report.browser = context.browser() ? context.browser().version() : 'Chromium persistent context';
  page = context.pages()[0] || await context.newPage();
}

async function panel(target = page) {
  const iframe = await target.waitForSelector('#xh-bar');
  const frame = await iframe.contentFrame();
  assert.ok(frame, 'Extension panel frame exists');
  await frame.locator('#query').waitFor({state: 'visible'});
  await frame.waitForFunction(() => typeof currentTabId !== 'undefined' && currentTabId !== null);
  return frame;
}

async function openPage(url, target = page) {
  await target.goto(url);
  // Content scripts run at document_idle; the fixture itself has no external resources.
  await target.waitForTimeout(150);
  await target.keyboard.press('Control+Shift+X');
  return panel(target);
}

async function query(frame, expression, expected, count, status) {
  await frame.locator('#query').fill(expression);
  await until(async () => await frame.locator('#results').inputValue() === expected &&
    await frame.locator('#node-count').textContent() === String(count), 'Query results for ' + expression);
  if (status) assert.equal(await frame.locator('#match-status').textContent(), status);
}

function library(frame, action, data = {}) {
  return frame.evaluate(request => new Promise(resolve => {
    chrome.runtime.sendMessage(request, response => resolve(response || {error: chrome.runtime.lastError?.message}));
  }), {type: 'library', action, ...data});
}

async function clipboardSink(frame, failure = false) {
  await frame.evaluate(reject => {
    window.__copied = [];
    window.__fallbackCopied = [];
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async value => {
      if (reject) throw new Error('Instrumented clipboard rejection');
      window.__copied.push(value);
    }}});
    document.execCommand = command => {
      if (command !== 'copy') return false;
      window.__fallbackCopied.push(document.activeElement.value);
      return true;
    };
  }, failure);
}

(async function main() {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const other = 'http://localhost:' + server.address().port;
  try {
    await launch();
    check('Chromium accepts the Manifest V3 extension', Boolean(report.extension_id));
    await page.goto(base + '/xpath-fixture');
    report.xpath_fixture = await page.evaluate(() => window.runXPathFixture());
    check('32 browser DOM fixtures verify literals, duplicates, SVG, images and rejected nodes', report.xpath_fixture.passed === 32);
    let frame = await openPage(base + '/');
    const first = page;
    check('Keyboard opens the panel and initializes its tab');
    await query(frame, '//li', 'Apple\nBanana', 2, '匹配 2 项');
    check('Node query highlights both matching elements', await page.locator('li.xh-highlight').count() === 2);
    for (const [expression, expected, status] of [
      ['count(//li)', '2', '数值结果'], ['boolean(//li)', '1', '布尔结果'], ['string(//li[1])', 'Apple', '文本结果']
    ]) await query(frame, expression, expected, 1, status);
    await query(frame, '//not-here', '[NULL]', 0, '未匹配到结果');
    await query(frame, '//*[', '[INVALID XPATH EXPRESSION]', 0, '表达式无效');
    check('Scalar, zero-match and invalid XPath statuses are distinguished');
    await page.locator('#order').dispatchEvent('mousemove', {bubbles: true, shiftKey: true});
    await until(async () => await frame.locator('#results').inputValue() === '提交订单', 'Shift picking result');
    check('Shift picking generates a working relative XPath', (await frame.locator('#query').inputValue()).startsWith('//'));
    await frame.locator('#mode').selectOption('absolute');
    await until(async () => (await frame.locator('#query').inputValue()).startsWith('/html'), 'Absolute mode generation');
    check('Absolute mode regenerates the selected element path');
    await frame.locator('#mode').selectOption('smart');
    await query(frame, '//li[1]', 'Apple', 1, '唯一匹配');
    await clipboardSink(frame);
    await frame.locator('#copy-query').click();
    await until(() => frame.evaluate(() => window.__copied.includes('//li[1]')), 'Copy XPath');
    await frame.locator('#copy-results').click();
    await until(() => frame.evaluate(() => window.__copied.includes('Apple')), 'Copy results');
    check('Copy buttons pass query and result text to the clipboard sink');
    await clipboardSink(frame, true);
    await frame.locator('#copy-query').click();
    await until(() => frame.evaluate(() => window.__fallbackCopied.includes('//li[1]')), 'Fallback copy');
    check('Clipboard rejection uses the selection-copy fallback without changing the query');
    await frame.evaluate(() => { document.execCommand = () => false; });
    await frame.locator('#copy-results').click();
    await until(async () => (await frame.locator('#notice').textContent()).includes('无法自动复制'), 'Manual copy fallback notice');
    check('Failed copy leaves the result selected with manual-copy instructions', await frame.evaluate(() => {
      const field = document.getElementById('results');
      return field.selectionStart === 0 && field.selectionEnd === field.value.length;
    }));
    await clipboardSink(frame);
    await until(async () => (await library(frame, 'list')).history?.some(item => item.query === '//li[1]'), 'History saved after copy');
    check('Copying XPath records local history');
    await frame.locator('#favorite-name').fill('首个商品');
    await frame.locator('#save-favorite').click();
    await until(async () => (await library(frame, 'list')).favorites?.length === 1, 'Favorite saved');
    const entry = (await library(frame, 'list')).favorites[0];
    check('Favorite button persists a named query', entry.name === '首个商品' && entry.query === '//li[1]');
    await query(frame, '//li[2]', 'Banana', 1);
    await frame.locator('#run-query').click();
    await until(async () => (await library(frame, 'list')).history?.some(item => item.query === '//li[2]'), 'Run saved to history');
    check('Explicit Run records history');
    await frame.locator('#toggle-library').click();
    await frame.locator('#favorites-list .entry-restore').first().waitFor();
    await page.screenshot({path: path.join(artifacts, 'panel-library.png')});
    await frame.locator('#favorites-list .entry-restore').first().click();
    await until(async () => await frame.locator('#results').inputValue() === 'Apple', 'Favorite restored');
    check('Selecting a saved query restores and evaluates it');
    const second = await context.newPage();
    page = second;
    frame = await openPage(base + '/second');
    check('Same-site favorite appears in another tab', (await library(frame, 'list')).favorites.length === 1);
    await query(frame, '//li[2]', 'Banana', 1);
    const firstFrame = await panel(first);
    check('Results remain isolated between tabs', await firstFrame.locator('#results').inputValue() === 'Apple');
    frame = await openPage(other + '/');
    const separate = await library(frame, 'list');
    check('Different origins have separate histories and favorites', separate.favorites.length === 0 && separate.history.length === 0);
    frame = await openPage(base + '/again');
    check('Favorite survives navigation and panel recreation', (await library(frame, 'list')).favorites.length === 1);
    await frame.locator('#toggle-library').click();
    await frame.locator('#clear-history').click();
    check('Clearing history requires confirmation', (await library(frame, 'list')).history.length > 0);
    await frame.locator('#clear-history').click();
    await until(async () => (await library(frame, 'list')).history.length === 0, 'History cleared');
    check('Clear-history button preserves favorites', (await library(frame, 'list')).favorites.length === 1);
    await frame.locator('#favorites-list .entry-remove').click();
    await until(async () => (await library(frame, 'list')).favorites.length === 0, 'Favorite removed');
    check('Remove button deletes the selected favorite');
    await frame.locator('#toggle-library').click();
    await query(frame, '//li', 'Apple\nBanana', 2);
    await frame.locator('#favorite-name').fill('重启后保留');
    await frame.locator('#save-favorite').click();
    await until(async () => (await library(frame, 'list')).favorites.length === 1, 'Persistence marker saved');
    await page.screenshot({path: path.join(artifacts, 'panel-desktop.png')});
    await page.setViewportSize({width: 640, height: 900});
    const controlsFit = await frame.evaluate(() => ['copy-query', 'close-panel', 'save-favorite'].every(id => {
      const rect = document.getElementById(id).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
    }));
    check('Panel controls fit at a 640px desktop width', controlsFit);
    await page.screenshot({path: path.join(artifacts, 'panel-narrow.png')});
    await frame.locator('#close-panel').click();
    await until(async () => (await page.locator('#xh-bar').getAttribute('class')).includes('hidden'), 'Panel closed');
    check('Close button hides panel and clears highlights', await page.locator('.xh-highlight').count() === 0);
    await context.close();
    context = null;
    await launch();
    frame = await openPage(base + '/after-restart');
    const persisted = await library(frame, 'list');
    check('Favorites survive a complete browser restart', persisted.favorites.length === 1 && persisted.favorites[0].name === '重启后保留');
    check('No browser console errors', report.console_errors.length === 0);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.stack || String(error);
    if (page && !page.isClosed()) {
      try { await page.screenshot({path: path.join(artifacts, 'failure.png')}); } catch (_) {}
    }
    process.exitCode = 1;
    console.error(report.error);
  } finally {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(artifacts, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('Report:', path.join(artifacts, 'browser-report.json'));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
