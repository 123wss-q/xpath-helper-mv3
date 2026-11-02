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

// Modified 2026-11-02: Manifest V3, tab-scoped routing, and local per-site library.
importScripts('library.js');

const LIBRARY_KEY = 'xpathHelperLibraryV1';
const library = XHLibrary.create({
  get() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(LIBRARY_KEY, function(result) {
        if (chrome.runtime.lastError) reject(new Error('无法读取本地资料，请稍后重试。'));
        else resolve(result[LIBRARY_KEY]);
      });
    });
  },
  set(value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({[LIBRARY_KEY]: value}, function() {
        if (chrome.runtime.lastError) reject(new Error('保存失败，请检查本地存储空间后重试。'));
        else resolve();
      });
    });
  }
});

// Keep saved selectors unavailable to content scripts, where supported.
if (typeof chrome.storage.local.setAccessLevel === 'function') {
  try {
    const access = chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
    if (access && typeof access.catch === 'function') access.catch(() => {});
  } catch (_) { /* Older browsers can still use the local library. */ }
}

function getSite(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, {type: 'context'}, {frameId: 0}, function(context) {
      if (chrome.runtime.lastError || !context) {
        reject(new Error('无法访问当前网页，请刷新网页后重试。'));
        return;
      }
      try { resolve(XHLibrary.normalizeSite(context.site)); } catch (error) { reject(error); }
    });
  });
}

function sendToPage(tabId, request) {
  chrome.tabs.sendMessage(tabId, request, {frameId: 0}, function() {
    // Browser-owned pages and tabs opened before installation have no receiver.
    void chrome.runtime.lastError;
  });
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  // Updates go directly from content.js to bar.js. Only relay panel commands.
  if (!request || !sender.tab || !Number.isInteger(sender.tab.id) || sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL('bar.html')) {
    return;
  }
  if (request.type === 'library') {
    if (sender.tab.incognito) {
      sendResponse({ok: false, error: '隐身窗口不保存或读取历史与收藏。'});
      return;
    }
    getSite(sender.tab.id).then(site => {
      // The frame can navigate between a click and this context lookup. The
      // caller's origin is only a precondition, never the storage key.
      if (typeof request.expectedSite === 'string' && request.expectedSite !== site) {
        throw new Error('网页已切换，请刷新面板后重试。');
      }
      return library.run(site, request);
    })
      .then(sendResponse, error => sendResponse({ok: false, error: error.message || '本地资料操作失败。'}));
    return true;
  }
  if (['ready', 'evaluate', 'mode', 'moveBar', 'hideBar'].includes(request.type)) {
    sendToPage(sender.tab.id, request);
    // Acknowledge accepted forwarding. Content commands publish their results
    // separately, and do not all reply on this request's message channel.
    sendResponse({ok: true});
  }
});

chrome.action.onClicked.addListener(function(tab) {
  if (Number.isInteger(tab.id)) {
    sendToPage(tab.id, {type: 'toggleBar'});
  }
});
