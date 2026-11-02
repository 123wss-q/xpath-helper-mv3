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

// Modified 2026-11-02: MV3 panel handshake, smart/absolute XPath generation,
// result-type feedback, and site context for the local history/favorites library.
var xh = xh || {};
xh.SHIFT_KEYCODE = 16;
xh.X_KEYCODE = 88;

xh.site = function() {
  return location.protocol === 'file:' ? 'file://' : location.origin;
};

xh.makeQueryForElement = function(el, mode) {
  return xhXPath.generate(el, mode || 'smart');
};

xh.clearHighlights = function() {
  document.querySelectorAll('.xh-highlight').forEach(function(el) {
    el.classList.remove('xh-highlight');
  });
};

xh.evaluateQuery = function(query) {
  if (!query.trim()) return {results: ['', 0], meta: {kind: 'empty'}};
  var values = [], count = 0, highlights = [], kind = 'nodes';
  try {
    var result = document.evaluate(query, document, null, XPathResult.ANY_TYPE, null);
    if (result.resultType === XPathResult.BOOLEAN_TYPE) {
      kind = 'boolean'; values.push(result.booleanValue ? '1' : '0'); count = 1;
    } else if (result.resultType === XPathResult.NUMBER_TYPE) {
      kind = 'number'; values.push(String(result.numberValue)); count = 1;
    } else if (result.resultType === XPathResult.STRING_TYPE) {
      kind = 'string'; values.push(result.stringValue); count = 1;
    } else {
      for (var node = result.iterateNext(); node; node = result.iterateNext()) {
        count++;
        values.push(node.textContent || '');
        if (node.nodeType === Node.ELEMENT_NODE && node.id !== 'xh-bar') {
          highlights.push(node);
        } else if (node.nodeType === Node.ATTRIBUTE_NODE && node.ownerElement) {
          highlights.push(node.ownerElement);
        }
      }
    }
    // Apply DOM mutations only after the XPath iterator is exhausted.
    highlights.forEach(function(el) { el.classList.add('xh-highlight'); });
    return {results: [count ? values.join('\n') : '[NULL]', count], meta: {kind: kind}};
  } catch (error) {
    return {results: ['[INVALID XPATH EXPRESSION]', 0],
      meta: {kind: 'error', error: String(error.message || 'XPath 无效').slice(0, 240)}};
  }
};

xh.Bar = function() {
  this.boundHandleRequest_ = this.handleRequest_.bind(this);
  this.boundMouseMove_ = this.mouseMove_.bind(this);
  this.boundKeyDown_ = this.keyDown_.bind(this);
  this.inDOM_ = false;
  this.currEl_ = null;
  this.query_ = '';
  this.mode_ = 'smart';
  this.generationError_ = '';
  this.barFrame_ = document.createElement('iframe');
  this.barFrame_.src = chrome.runtime.getURL('bar.html');
  this.barFrame_.id = 'xh-bar';
  this.barFrame_.title = 'XPath Helper';
  this.barFrame_.classList.add('hidden');
  document.addEventListener('keydown', this.boundKeyDown_);
  chrome.runtime.onMessage.addListener(this.boundHandleRequest_);
};

xh.Bar.prototype.hidden_ = function() {
  return this.barFrame_.classList.contains('hidden');
};

xh.Bar.prototype.updateQueryAndBar_ = function(el) {
  xh.clearHighlights();
  this.generationError_ = '';
  try {
    this.query_ = el ? xh.makeQueryForElement(el, this.mode_) : '';
  } catch (error) {
    this.query_ = '';
    this.generationError_ = String(error.message || '无法为这个元素生成 XPath');
  }
  this.updateBar_(true);
};

xh.Bar.prototype.updateBar_ = function(updateQuery) {
  // Also clear before a ready refresh: extension-added classes must never alter
  // attribute/class XPath matching or stale highlights.
  xh.clearHighlights();
  var output = this.generationError_ ? {
    results: ['', 0], meta: {kind: 'error', error: this.generationError_}
  } : xh.evaluateQuery(this.query_);
  chrome.runtime.sendMessage({type: 'update',
    query: updateQuery ? this.query_ : null,
    evaluatedQuery: this.query_,
    results: output.results, meta: output.meta, site: xh.site(), mode: this.mode_
  }, function() { void chrome.runtime.lastError; });
};

xh.Bar.prototype.showBar_ = function() {
  if (!this.inDOM_) {
    this.inDOM_ = true;
    (document.body || document.documentElement).appendChild(this.barFrame_);
  }
  var that = this;
  window.setTimeout(function() {
    that.barFrame_.classList.remove('hidden');
    document.addEventListener('mousemove', that.boundMouseMove_);
    that.updateBar_(true);
  }, 0);
};

xh.Bar.prototype.hideBar_ = function() {
  this.barFrame_.classList.add('hidden');
  document.removeEventListener('mousemove', this.boundMouseMove_);
  xh.clearHighlights();
};

xh.Bar.prototype.toggleBar_ = function() {
  if (this.hidden_()) this.showBar_();
  else this.hideBar_();
};

xh.Bar.prototype.handleRequest_ = function(request, sender, reply) {
  if (!request || !sender || sender.id !== chrome.runtime.id) return;
  if (request.type === 'context') {
    reply({site: xh.site()});
  } else if (request.type === 'ready') {
    this.updateBar_(true);
  } else if (request.type === 'evaluate') {
    if (typeof request.query !== 'string' || request.query.length > 4096) return;
    this.query_ = request.query;
    this.generationError_ = '';
    this.updateBar_(false);
  } else if (request.type === 'mode') {
    if (request.mode !== 'smart' && request.mode !== 'absolute') return;
    this.mode_ = request.mode;
    if (this.currEl_ && this.currEl_.isConnected) this.updateQueryAndBar_(this.currEl_);
    else this.updateBar_(false);
  } else if (request.type === 'moveBar') {
    this.barFrame_.classList.toggle('bottom');
  } else if (request.type === 'hideBar') {
    this.hideBar_();
    window.focus();
  } else if (request.type === 'toggleBar') {
    this.toggleBar_();
  }
};

xh.Bar.prototype.mouseMove_ = function(event) {
  var element = event.target;
  if (!element || element.nodeType !== Node.ELEMENT_NODE ||
      element === this.barFrame_ || this.currEl_ === element) return;
  this.currEl_ = element;
  if (event.shiftKey) this.updateQueryAndBar_(element);
};

xh.Bar.prototype.keyDown_ = function(event) {
  var ctrl = event.ctrlKey || event.metaKey;
  if ((event.code === 'KeyX' || event.keyCode === xh.X_KEYCODE) && ctrl && event.shiftKey) {
    event.preventDefault();
    this.toggleBar_();
  } else if (!this.hidden_() && !ctrl &&
      (event.key === 'Shift' || event.keyCode === xh.SHIFT_KEYCODE)) {
    this.updateQueryAndBar_(this.currEl_);
  }
};

window.xhBarInstance = new xh.Bar();
