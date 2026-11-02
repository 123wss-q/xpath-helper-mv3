/*
 * XPath generation for the independent XPath Helper MV3 adaptation.
 * SPDX-License-Identifier: Apache-2.0
 * Added 2026-11-02: validated relative paths, XPath 1.0 literals and SVG support.
 */
'use strict';

(function(root) {
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const MAX_EVALUATIONS = 48;
  const MAX_DEPTH = 128;
  const ATTRIBUTES = ['id', 'data-testid', 'data-test-id', 'data-test', 'data-qa',
    'name', 'aria-label', 'placeholder', 'title', 'role', 'type'];

  function literal(value) {
    const text = String(value);
    if (!text.includes("'")) return "'" + text + "'";
    if (!text.includes('"')) return '"' + text + '"';
    const parts = [];
    text.split("'").forEach(function(part, index) {
      if (index) parts.push('"\'"');
      if (part) parts.push("'" + part + "'");
    });
    return 'concat(' + parts.join(', ') + ')';
  }

  function nodeTest(element) {
    const name = element.localName;
    const namespace = element.namespaceURI || '';
    if (namespace === HTML_NS && element.ownerDocument.contentType === 'text/html') {
      return name.toLowerCase();
    }
    // Explicit namespace tests also handle SVG, MathML and XML without a resolver.
    return '*[local-name()=' + literal(name) + ' and namespace-uri()=' +
      literal(namespace) + ']';
  }

  function sameType(first, second) {
    return first.localName === second.localName &&
      first.namespaceURI === second.namespaceURI;
  }

  function structuralStep(element) {
    let index = 1;
    for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sameType(element, sibling)) index++;
    }
    let repeated = index > 1;
    for (let sibling = element.nextElementSibling; !repeated && sibling; sibling = sibling.nextElementSibling) {
      repeated = sameType(element, sibling);
    }
    return nodeTest(element) + (repeated ? '[' + index + ']' : '');
  }

  function looksGenerated(value) {
    // Heuristics only: the validated match describes the current DOM, not future stability.
    return value.length > 120 || /^\d{6,}$/.test(value) ||
      /[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/i.test(value) ||
      /(?:^|[-_])[a-f\d]{12,}(?:$|[-_])/i.test(value) ||
      /^:r[a-z\d]+:$/i.test(value) ||
      /^(?:ember\d+|react-select-\d+|headlessui-|radix-|mui-\d+|mat-input-\d+)/i.test(value);
  }

  function shortText(element) {
    if (/^(?:html|head|body|script|style|svg|textarea|select)$/i.test(element.localName) ||
        element.childElementCount > 3) return '';
    const walker = element.ownerDocument.createTreeWalker(element, 4); // SHOW_TEXT
    let text = '', count = 0, node;
    while ((node = walker.nextNode())) {
      if (++count > 24 || text.length + node.nodeValue.length > 160) return '';
      text += node.nodeValue;
    }
    text = text.replace(/[\t\n\r ]+/g, ' ').trim();
    return text && text.length <= 80 && !/^[\d\s.,:/+-]+$/.test(text) ? text : '';
  }

  function candidates(element, includeText) {
    const tag = nodeTest(element);
    const attributes = [];
    const queries = [];
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (!value || value.length > 160 || (name === 'id' && looksGenerated(value))) continue;
      const predicate = '@' + name + '=' + literal(value);
      attributes.push(predicate);
      queries.push((name === 'id' ? '*' : tag) + '[' + predicate + ']');
    }
    // A pair can distinguish duplicate labels/IDs without depending on an index.
    for (let i = 0; i < Math.min(attributes.length, 3); i++) {
      for (let j = i + 1; j < Math.min(attributes.length, 4); j++) {
        queries.push(tag + '[' + attributes[i] + ' and ' + attributes[j] + ']');
      }
    }
    if (includeText) {
      const text = shortText(element);
      if (text) {
        const predicate = 'normalize-space(.)=' + literal(text);
        queries.push(tag + '[' + predicate + ']');
        if (attributes.length) queries.push(tag + '[' + attributes[0] + ' and ' + predicate + ']');
      }
    }
    // Token tests tolerate unrelated class changes and the extension's own highlight.
    const classes = (element.getAttribute('class') || '').split(/\s+/).filter(function(value) {
      return value && value !== 'xh-highlight' && value.length <= 60 &&
        !looksGenerated(value) && !/^(?:css-|jsx-|sc-|jss\d|ng-|is-|has-)/i.test(value);
    }).slice(0, 2);
    const classTests = classes.map(function(value) {
      return "contains(concat(' ', normalize-space(@class), ' '), " + literal(' ' + value + ' ') + ')';
    });
    for (const predicate of classTests) queries.push(tag + '[' + predicate + ']');
    if (classTests.length > 1) queries.push(tag + '[' + classTests.join(' and ') + ']');
    return queries;
  }

  function generate(element, mode = 'smart') {
    if (!element || element.nodeType !== 1 || !element.ownerDocument) {
      throw new TypeError('Please select a page element.');
    }
    const doc = element.ownerDocument;
    if (!doc.documentElement || !doc.documentElement.contains(element)) {
      throw new Error('The element is detached or inside a Shadow DOM; select an element in the main document.');
    }
    if ((element.localName === 'iframe' && element.id === 'xh-bar') ||
        /^chrome-extension:\/\/[^/]+\/bar\.html(?:[?#]|$)/.test(doc.URL || '')) {
      throw new Error('The XPath Helper panel cannot be selected.');
    }
    if (typeof doc.evaluate !== 'function') throw new Error('XPath is unavailable in this document.');

    let evaluations = 0;
    const checked = new Set();
    function matches(query, finalCheck) {
      if (checked.has(query) || (!finalCheck && evaluations >= MAX_EVALUATIONS - 1)) return false;
      checked.add(query);
      evaluations++;
      try {
        const result = doc.evaluate(query, doc, null, 4, null); // UNORDERED_NODE_ITERATOR_TYPE
        return result.iterateNext() === element && result.iterateNext() === null;
      } catch (_) {
        return false;
      }
    }
    function finish(query) {
      // Preserve the original helper's image-source selection behavior.
      return query + (element.localName.toLowerCase() === 'img' &&
        element.namespaceURI === HTML_NS ? '/@src' : '');
    }

    if (mode !== 'absolute') {
      for (const candidate of candidates(element, true)) {
        const query = '//' + candidate;
        if (matches(query)) return finish(query);
      }
      // Restrict ancestor searching; the structural fallback below is always available.
      let descendant = structuralStep(element);
      let ancestor = element.parentElement;
      for (let depth = 0; ancestor && depth < 6 && evaluations < MAX_EVALUATIONS - 1; depth++) {
        for (const candidate of candidates(ancestor, false).slice(0, 5)) {
          const query = '//' + candidate + '/' + descendant;
          if (matches(query)) return finish(query);
        }
        descendant = structuralStep(ancestor) + '/' + descendant;
        ancestor = ancestor.parentElement;
      }
    }

    const steps = [];
    for (let current = element; current; current = current.parentElement) {
      if (steps.length >= MAX_DEPTH) throw new Error('The element is nested too deeply to generate a bounded XPath.');
      steps.unshift(structuralStep(current));
    }
    const absolute = '/' + steps.join('/');
    if (!matches(absolute, true)) {
      throw new Error('The page changed while generating XPath. Select the element again.');
    }
    return finish(absolute);
  }

  root.xhXPath = Object.freeze({literal, generate});
})(globalThis);
