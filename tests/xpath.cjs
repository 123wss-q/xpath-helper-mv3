// SPDX-License-Identifier: Apache-2.0
'use strict';
const assert = require('node:assert/strict');
require('../xpath.js');
const {literal, generate} = globalThis.xhXPath;

// Read only the XPath 1.0 string/concat grammar, independently of the generator.
function readLiteral(expression) {
  let offset = 0;
  function skipSpace() { while (/\s/.test(expression[offset] || '') && offset < expression.length) offset++; }
  function readString() {
    skipSpace();
    const quote = expression[offset++];
    assert.ok(quote === "'" || quote === '"', 'XPath string must start with a quote');
    const end = expression.indexOf(quote, offset);
    assert.notEqual(end, -1, 'XPath string must have a matching delimiter');
    const result = expression.slice(offset, end);
    offset = end + 1;
    return result;
  }
  let result;
  if (expression.startsWith('concat(')) {
    offset = 7;
    const parts = [readString()];
    skipSpace();
    while (expression[offset] === ',') { offset++; parts.push(readString()); skipSpace(); }
    assert.ok(parts.length >= 2, 'XPath 1.0 concat requires at least two arguments');
    assert.equal(expression[offset++], ')');
    result = parts.join('');
  } else {
    result = readString();
  }
  skipSpace();
  assert.equal(offset, expression.length, 'No unparsed XPath instructions may remain');
  return result;
}

const cases = ['', 'plain', "it's", 'a "quoted" label', 'He said "it\'s ready"',
  "'", '"', "'\"", "\"'", "''\"''", '中文 😀', "a\nb\tc\rd", "x'] | //* | //*[@id='y", '\\', 0, false, null];
for (const value of cases) assert.equal(readLiteral(literal(value)), String(value));
// Exhaust every short string from a punctuation-heavy alphabet, including injection-like data.
const alphabet = ["'", '"', ',', ')', 'a', '中'];
let generated = 0;
function walk(text, remaining) {
  assert.equal(readLiteral(literal(text)), text);
  generated++;
  if (remaining) for (const character of alphabet) walk(text + character, remaining - 1);
}
walk('', 4);
assert.throws(() => generate(null), /select a page element/i);
assert.throws(() => generate({nodeType: 3}), /select a page element/i);
console.log(`PASS: ${cases.length + generated} XPath literal round trips and invalid-selection checks.`);
console.log('DOM uniqueness, SVG and structural paths are covered by the browser fixture.');
