import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateLegacyCompatibilityCss } from './css-containment-validator.mjs';

const R = '.widget-settings-legacy-compat';

test('validates actual compat CSS with >20 selectors', async () => {
  const css = await readFile(new URL('../src/compat/widget-settings-legacy-compat.css', import.meta.url), 'utf8');
  const count = validateLegacyCompatibilityCss(css);
  assert.ok(count > 20, `Expected >20 selectors, got ${count}`);
});

test('accepts fully rooted rules', () => {
  assert.equal(validateLegacyCompatibilityCss(`${R} .a { color: red; }\n${R} .b, ${R} .c { display: flex; }`), 3);
});

test('rejects leak-first in selector list', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`.leak, ${R} .ok { color: red; }`), /SyntaxError/);
});

test('rejects leak-last in selector list', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .ok, .leak { color: red; }`), /SyntaxError/);
});

test('rejects leak under nested @media + @supports', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@media (max-width: 767px) { @supports (display: grid) { .leak { color: red; } } }`), /SyntaxError/);
});

test('rejects leading comment before a leak', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`/* comment */ .leak { color: red; }`), /SyntaxError/);
});

test('rejects inline comment before a leak', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .ok, /* tricky */ .leak { color: red; }`), /SyntaxError/);
});

test('handles quoted braces and commas followed by a leak', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} [attr="{},"] { content: "ok"; }\n.leak { color: red; }`), /SyntaxError/);
});

test('accepts rooted rule with escaped tokens in values', () => {
  assert.equal(validateLegacyCompatibilityCss(`${R} .ok { content: "\\{\\}\\,"; }`), 1);
});

test('rejects global @keyframes (one-line)', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }`), /keyframes.*not allowed/i);
});

test('rejects multiline @keyframes', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@keyframes fade {\n  0% { opacity: 0; }\n  100% { opacity: 1; }\n}`), /keyframes.*not allowed/i);
});

test('rejects @-webkit-keyframes', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@-webkit-keyframes slide { from { left: 0; } }`), /keyframes.*not allowed/i);
});

test('rejects nested @keyframes inside @media', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@media all { @keyframes x { from { opacity: 0; } } }`), /keyframes.*not allowed/i);
});

test('rejects root lookalike suffix', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R}-extra .a { color: red; }`), /does not begin with/);
});

test('rejects root only inside :not()', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`:not(${R}) .a { color: red; }`), /does not begin with/);
});

test('rejects unknown at-rule (@import)', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@import "other.css";`), /not.*allowed/i);
});

test('rejects unknown at-rule (@layer)', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@layer base { ${R} .a { color: red; } }`), /not.*allowed/i);
});

test('rejects unclosed comment', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`/* unclosed\n${R} .a { color: red; }`), /unterminated/i);
});

test('rejects unclosed string', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a { content: "unclosed; }`), /unterminated/i);
});

test('rejects unclosed block', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a { color: red;`), /unmatched/i);
});

test('accepts rooted @media with rooted selectors', () => {
  assert.equal(validateLegacyCompatibilityCss(`@media (max-width: 767px) { ${R} .a { color: red; } ${R} .b { display: none; } }`), 2);
});
