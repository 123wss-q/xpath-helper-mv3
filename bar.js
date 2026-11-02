/**
 * Copyright 2011 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @author opensource@google.com
 * @license Apache License, Version 2.0.
 */

'use strict';

// Modified 2026-11-02: v2.1 copy tools, generation modes and a per-site local library.
var currentTabId = null;
var currentSite = null;
var incognito = false;
var libraryGeneration = 0;
var libraryRequestId = 0;
var currentLibrary = {history: [], favorites: []};
var inputTimer = null;
var clearTimer = null;
var clearConfirmation = null;
var lastMoveTimeInMs = 0;
var MAX_QUERY_LENGTH = 4096;

var queryEl = document.getElementById('query');
var resultsEl = document.getElementById('results');
var nodeCountEl = document.getElementById('node-count');
var modeEl = document.getElementById('mode');
var noticeEl = document.getElementById('notice');
var matchStatusEl = document.getElementById('match-status');
var favoriteNameEl = document.getElementById('favorite-name');
var libraryPanelEl = document.getElementById('library-panel');
var libraryStateEl = document.getElementById('library-state');
var siteLabelEl = document.getElementById('site-label');
var historyListEl = document.getElementById('history-list');
var favoritesListEl = document.getElementById('favorites-list');
var toggleLibraryEl = document.getElementById('toggle-library');
var copyQueryEl = document.getElementById('copy-query');
var copyResultsEl = document.getElementById('copy-results');
var saveFavoriteEl = document.getElementById('save-favorite');
var clearHistoryEl = document.getElementById('clear-history');
var clearFavoritesEl = document.getElementById('clear-favorites');

function showNotice(message, isError) {
  noticeEl.textContent = message;
  noticeEl.title = message;
  noticeEl.dataset.error = isError ? 'true' : 'false';
}

function canUseLibrary() {
  return !incognito && typeof currentSite === 'string' && currentSite.length > 0 && currentSite !== 'null';
}

function updateControls() {
  var hasQuery = queryEl.value.trim().length > 0 && queryEl.value.length <= MAX_QUERY_LENGTH;
  copyQueryEl.disabled = !hasQuery;
  saveFavoriteEl.disabled = !hasQuery || !canUseLibrary();
  clearHistoryEl.disabled = !canUseLibrary() || !currentLibrary.history.length;
  clearFavoritesEl.disabled = !canUseLibrary() || !currentLibrary.favorites.length;
}

function sendPageCommand(request) {
  chrome.runtime.sendMessage(request, function() {
    if (chrome.runtime.lastError) {
      showNotice('无法连接当前网页，请刷新网页后重试。', true);
    }
  });
}

function cancelPendingInput() {
  if (inputTimer !== null) {
    clearTimeout(inputTimer);
    inputTimer = null;
  }
}

function evaluateQuery(remember) {
  cancelPendingInput();
  if (queryEl.value.length > MAX_QUERY_LENGTH) {
    showNotice('XPath 最长为 4096 个字符，请缩短表达式。', true);
    return;
  }
  sendPageCommand({type: 'evaluate', query: queryEl.value});
  if (remember && queryEl.value.trim() && canUseLibrary()) {
    requestLibrary('remember', {query: queryEl.value}, '已运行并保存到当前网站历史。');
  } else if (remember && incognito) {
    showNotice('已运行；隐身窗口不保存历史与收藏。');
  }
}

function showLibrary(isOpen) {
  libraryPanelEl.hidden = !isOpen;
  document.getElementById('results-box').hidden = isOpen;
  toggleLibraryEl.setAttribute('aria-expanded', String(isOpen));
  toggleLibraryEl.textContent = isOpen ? '返回结果' : '历史与收藏';
}

function emptyList(list, message) {
  list.replaceChildren();
  var paragraph = document.createElement('p');
  paragraph.className = 'empty-state';
  paragraph.textContent = message;
  list.appendChild(paragraph);
}

function restoreEntry(entry, isFavorite) {
  cancelPendingInput();
  queryEl.value = entry.query;
  favoriteNameEl.value = isFavorite ? (entry.name || '') : '';
  updateControls();
  evaluateQuery(false);
  showLibrary(false);
  showNotice(isFavorite ? '已恢复收藏并运行。' : '已恢复历史查询并运行。');
}

function renderEntries(list, entries, isFavorite) {
  list.replaceChildren();
  if (!entries.length) {
    emptyList(list, isFavorite ? '暂无收藏。输入名称后点击“收藏”。' : '运行或复制 XPath 后显示在这里。');
    return;
  }
  entries.forEach(function(entry) {
    var row = document.createElement('div');
    row.className = 'library-entry';
    var restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'entry-restore';
    restore.title = entry.query;
    if (entry.name) {
      var name = document.createElement('span');
      name.className = 'entry-name';
      name.textContent = entry.name;
      restore.appendChild(name);
    }
    var expression = document.createElement('span');
    expression.className = 'entry-query';
    expression.textContent = entry.query;
    restore.appendChild(expression);
    restore.addEventListener('click', function() { restoreEntry(entry, isFavorite); });
    row.appendChild(restore);
    if (isFavorite) {
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'entry-remove';
      remove.textContent = '×';
      remove.title = '删除此收藏';
      remove.setAttribute('aria-label', '删除收藏：' + (entry.name || entry.query));
      remove.addEventListener('click', function() {
        requestLibrary('remove', {id: entry.id}, '已删除收藏。');
      });
      row.appendChild(remove);
    }
    list.appendChild(row);
  });
}

function resetClearConfirmation() {
  clearConfirmation = null;
  if (clearTimer !== null) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  clearHistoryEl.textContent = '清空';
  clearFavoritesEl.textContent = '清空';
}

function clearLibrary(action) {
  if (!canUseLibrary()) return;
  if (!clearConfirmation || clearConfirmation.action !== action || clearConfirmation.site !== currentSite) {
    resetClearConfirmation();
    clearConfirmation = {action: action, site: currentSite};
    var button = action === 'clear-history' ? clearHistoryEl : clearFavoritesEl;
    button.textContent = '确认清空';
    showNotice('再次点击“确认清空”，仅删除当前网站的' + (action === 'clear-history' ? '历史。' : '收藏。'));
    clearTimer = setTimeout(resetClearConfirmation, 6000);
    return;
  }
  resetClearConfirmation();
  requestLibrary(action, {}, action === 'clear-history' ? '已清空当前网站历史。' : '已清空当前网站收藏。');
}

function requestLibrary(action, payload, successMessage) {
  if (!canUseLibrary()) return;
  var generation = libraryGeneration;
  var site = currentSite;
  var requestId = ++libraryRequestId;
  libraryStateEl.textContent = action === 'list' ? '读取中…' : '保存中…';
  var request = Object.assign({type: 'library', action: action, expectedSite: site}, payload || {});
  chrome.runtime.sendMessage(request, function(response) {
    var transportError = chrome.runtime.lastError;
    if (generation !== libraryGeneration || site !== currentSite || requestId !== libraryRequestId) return;
    if (transportError || !response || !response.ok) {
      var error = (response && response.error) || '无法读取本地记录，请刷新网页后重试。';
      libraryStateEl.textContent = '暂不可用';
      libraryStateEl.title = error;
      if (action !== 'list') showNotice(error, true);
      if (!currentLibrary.history.length) emptyList(historyListEl, error);
      if (!currentLibrary.favorites.length) emptyList(favoritesListEl, error);
      return;
    }
    // A navigation can race with the worker's context lookup. Never show another site's records.
    if (response.site !== site) {
      libraryStateEl.textContent = '网页已切换，请刷新';
      return;
    }
    currentLibrary = {
      history: Array.isArray(response.history) ? response.history : [],
      favorites: Array.isArray(response.favorites) ? response.favorites : []
    };
    libraryStateEl.textContent = '仅本机';
    libraryStateEl.title = '仅保存表达式和收藏名称，不保存网页结果。';
    renderEntries(historyListEl, currentLibrary.history, false);
    renderEntries(favoritesListEl, currentLibrary.favorites, true);
    updateControls();
    if (successMessage) showNotice(successMessage);
  });
}

function updateSite(site) {
  if (site === currentSite) return;
  currentSite = typeof site === 'string' && site ? site : null;
  libraryGeneration++;
  currentLibrary = {history: [], favorites: []};
  favoriteNameEl.value = '';
  resetClearConfirmation();
  siteLabelEl.textContent = currentSite === 'file://' ? '本地文件' : (currentSite || '尚未识别当前网站');
  siteLabelEl.title = siteLabelEl.textContent;
  var message = incognito ? '隐身窗口不保存或读取历史与收藏。' : '正在读取当前网站记录…';
  if (!canUseLibrary() && !incognito) message = '当前页面不支持保存记录。';
  emptyList(historyListEl, message);
  emptyList(favoritesListEl, message);
  libraryStateEl.textContent = incognito ? '隐身模式' : '';
  updateControls();
  requestLibrary('list');
}

function updateMatchStatus(meta, count) {
  var kind = meta && meta.kind ? meta.kind : (queryEl.value ? 'nodes' : 'empty');
  var text;
  if (kind === 'error') text = '表达式无效';
  else if (kind === 'empty') text = '等待选择元素或输入 XPath';
  else if (kind === 'nodes') text = count === 1 ? '唯一匹配' : (count ? '匹配 ' + count + ' 项' : '未匹配到结果');
  else text = ({string: '文本结果', number: '数值结果', boolean: '布尔结果'})[kind] || '查询完成';
  matchStatusEl.textContent = text;
  matchStatusEl.title = meta && meta.error ? meta.error : text;
  matchStatusEl.dataset.kind = kind === 'nodes' ? (count === 1 ? 'unique' : (count > 1 ? 'multiple' : 'empty')) : kind;
  copyResultsEl.disabled = !resultsEl.value || kind === 'error' || kind === 'empty' || (kind === 'nodes' && count === 0);
}

function handleRequest(request, sender) {
  if (!request || request.type !== 'update' || !sender || sender.id !== chrome.runtime.id ||
      !sender.tab || sender.tab.id !== currentTabId || sender.frameId !== 0) return;
  if (typeof request.query === 'string') {
    cancelPendingInput();
    queryEl.value = request.query;
  }
  // An older evaluation may return while another expression is being typed.
  if (typeof request.evaluatedQuery === 'string' && request.evaluatedQuery !== queryEl.value) return;
  if (Array.isArray(request.results)) {
    resultsEl.value = String(request.results[0] == null ? '' : request.results[0]);
    var count = Number(request.results[1]);
    if (!Number.isFinite(count)) count = 0;
    nodeCountEl.textContent = String(count);
    updateMatchStatus(request.meta, count);
  }
  if (request.mode === 'smart' || request.mode === 'absolute') modeEl.value = request.mode;
  if (typeof request.site === 'string') updateSite(request.site);
  updateControls();
}

function fallbackCopy(source, text) {
  var active = document.activeElement;
  var start = source.selectionStart;
  var end = source.selectionEnd;
  source.focus();
  source.select();
  // Do not replace a newer picked expression or silently copy a different value.
  if (source.value !== text) return false;
  var copied = false;
  try { copied = document.execCommand('copy'); } catch (error) { copied = false; }
  if (copied) {
    if (typeof source.setSelectionRange === 'function') source.setSelectionRange(start, end);
    if (active && typeof active.focus === 'function') active.focus();
  }
  return copied;
}

function copyText(source, label, remember) {
  var text = source.value;
  if (!text || (source === queryEl && text.length > MAX_QUERY_LENGTH)) return;
  var clickedSite = currentSite;
  var generation = libraryGeneration;
  var operation;
  try {
    operation = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('Clipboard API unavailable'));
  } catch (error) {
    operation = Promise.reject(error);
  }
  Promise.resolve(operation).then(function() { return true; }, function() { return fallbackCopy(source, text); }).then(function(copied) {
    if (!copied) {
      showNotice(source.value !== text ?
        '内容已更新，已选中当前文字，请按 Ctrl / Command + C。' :
        '无法自动复制，已选中文字，请按 Ctrl / Command + C。', true);
      return;
    }
    showNotice('已复制' + label + '。');
    if (remember && canUseLibrary() && clickedSite === currentSite && generation === libraryGeneration) {
      requestLibrary('remember', {query: text});
    }
  });
}

queryEl.addEventListener('input', function() {
  cancelPendingInput();
  updateControls();
  matchStatusEl.textContent = '正在查询…';
  matchStatusEl.dataset.kind = 'pending';
  copyResultsEl.disabled = true;
  inputTimer = setTimeout(function() { inputTimer = null; evaluateQuery(false); }, 150);
});
document.getElementById('run-query').addEventListener('click', function() { evaluateQuery(true); });
copyQueryEl.addEventListener('click', function() { copyText(queryEl, ' XPath', true); });
copyResultsEl.addEventListener('click', function() { copyText(resultsEl, '结果', false); });
saveFavoriteEl.addEventListener('click', function() {
  if (!queryEl.value.trim() || queryEl.value.length > MAX_QUERY_LENGTH) return;
  requestLibrary('favorite', {query: queryEl.value, name: favoriteNameEl.value.trim()}, '已保存收藏；相同表达式会更新名称。');
});
modeEl.addEventListener('change', function() {
  cancelPendingInput();
  sendPageCommand({type: 'mode', mode: modeEl.value});
  showNotice(modeEl.value === 'smart' ? '已切换为智能相对 XPath；按住 Shift 指向元素生成。' : '已切换为绝对 XPath；按住 Shift 指向元素生成。');
});
toggleLibraryEl.addEventListener('click', function() {
  var opening = libraryPanelEl.hidden;
  showLibrary(opening);
  if (opening) requestLibrary('list');
});
clearHistoryEl.addEventListener('click', function() { clearLibrary('clear-history'); });
clearFavoritesEl.addEventListener('click', function() { clearLibrary('clear-favorites'); });
document.getElementById('close-panel').addEventListener('click', function() {
  cancelPendingInput();
  sendPageCommand({type: 'hideBar'});
});
document.getElementById('panel-title').addEventListener('mousemove', function(event) {
  if (!event.shiftKey || Date.now() - lastMoveTimeInMs < 400) return;
  lastMoveTimeInMs = Date.now();
  sendPageCommand({type: 'moveBar'});
});
document.addEventListener('keydown', function(event) {
  var modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.shiftKey && (event.key === 'X' || event.key === 'x' || event.keyCode === 88)) {
    event.preventDefault();
    cancelPendingInput();
    sendPageCommand({type: 'hideBar'});
  } else if (modifier && (event.key === 'Enter' || event.keyCode === 13)) {
    event.preventDefault();
    evaluateQuery(true);
  }
});

chrome.runtime.onMessage.addListener(handleRequest);
chrome.tabs.getCurrent(function(tab) {
  if (chrome.runtime.lastError || !tab || !Number.isInteger(tab.id)) {
    showNotice('请从网页中的 XPath Helper 面板使用此页面。', true);
    return;
  }
  currentTabId = tab.id;
  incognito = Boolean(tab.incognito);
  if (incognito) showNotice('隐身窗口：查询与复制可用，不保存历史或收藏。');
  sendPageCommand({type: 'ready'});
});
