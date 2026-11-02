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

// Modified 2026-11-02: Manifest V3 service worker and tab-scoped routing.
function sendToPage(tabId, request) {
  chrome.tabs.sendMessage(tabId, request, {frameId: 0}, function() {
    // Browser-owned pages and tabs opened before installation have no receiver.
    void chrome.runtime.lastError;
  });
}

chrome.runtime.onMessage.addListener(function(request, sender) {
  // Updates go directly from content.js to bar.js. Only relay panel commands.
  if (!request || !sender.tab || sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL('bar.html')) {
    return;
  }
  if (['ready', 'evaluate', 'moveBar', 'hideBar'].includes(request.type)) {
    sendToPage(sender.tab.id, request);
  }
});

chrome.action.onClicked.addListener(function(tab) {
  if (Number.isInteger(tab.id)) {
    sendToPage(tab.id, {type: 'toggleBar'});
  }
});
