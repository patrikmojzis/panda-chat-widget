import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateLegacyCompatibilityCss } from './css-containment-validator.mjs';

const R = '.widget-settings-legacy-compat';

// ─── Actual production CSS ───
test('validates actual compat CSS with >20 selectors', async () => {
  const css = await readFile(new URL('../src/compat/widget-settings-legacy-compat.css', import.meta.url), 'utf8');
  const count = validateLegacyCompatibilityCss(css);
  assert.ok(count > 20, `Expected >20 selectors, got ${count}`);
});

// ─── Valid controls ───
test('accepts fully rooted rules', () => {
  assert.equal(validateLegacyCompatibilityCss(`${R} .a { color: red; }\n${R} .b, ${R} .c { display: flex; }`), 3);
});
test('accepts rooted @media with rooted selectors', () => {
  assert.equal(validateLegacyCompatibilityCss(`@media (max-width: 767px) { ${R} .a { color: red; } ${R} .b { display: none; } }`), 2);
});
test('accepts rooted rule with escaped tokens in values', () => {
  assert.equal(validateLegacyCompatibilityCss(`${R} .ok { content: "\\{\\}\\,"; }`), 1);
});
test('accepts escaped unquoted comma/brace in rooted selector', () => {
  assert.equal(validateLegacyCompatibilityCss(`${R} .a\\, ${R} .b { color: red; }`), 1);
});
test('accepts quoted comment marker in all-rooted rule', () => {
  assert.equal(validateLegacyCompatibilityCss(`${R} .a { content: "/*"; }\n${R} .b { color: red; }`), 2);
});

// ─── Leak adversaries ───
test('rejects leak-first in selector list', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`.leak, ${R} .ok { color: red; }`), /unrooted selector/);
});
test('rejects leak-last in selector list', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .ok, .leak { color: red; }`), /unrooted selector/);
});
test('rejects leak under nested @media + @supports', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@media all { @supports (display: grid) { .leak { color: red; } } }`), /unrooted selector/);
});
test('rejects leading comment before a leak', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`/* comment */ .leak { color: red; }`), /unrooted selector/);
});
test('rejects inline comment before a leak', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .ok, /* tricky */ .leak { color: red; }`), /unrooted selector/);
});
test('rejects root lookalike suffix', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R}-extra .a { color: red; }`), /unrooted selector/);
});
test('rejects root only inside :not()', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`:not(${R}) .a { color: red; }`), /unrooted selector/);
});
test('quoted braces/commas followed by a leak', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} [attr="{},"] { content: "ok"; }\n.leak { color: red; }`), /unrooted selector/);
});
test('quoted comment marker followed by leak is rejected', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a { content: "/*"; } .leak { color: red; }`), /unrooted selector/);
});
test('escaped comma does not split, but real comma after exposes leak', () => {
  assert.equal(validateLegacyCompatibilityCss(`${R} .a\\, .b { color: red; }`), 1);
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a\\,b, .leak { color: red; }`), /unrooted selector/);
});

// ─── Keyframes ───
test('rejects global @keyframes', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }`), /keyframes.*not allowed/i);
});
test('rejects @-webkit-keyframes', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@-webkit-keyframes slide { from { left: 0; } }`), /keyframes.*not allowed/i);
});
test('rejects nested @keyframes inside @media', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@media all { @keyframes x { from { opacity: 0; } } }`), /keyframes.*not allowed/i);
});

// ─── Unknown at-rules ───
test('rejects @import', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@import "other.css";`), /not.*allowed/i);
});
test('rejects @layer', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@layer base { ${R} .a { color: red; } }`), /not.*allowed/i);
});

// ─── Unterminated ───
test('rejects unclosed comment', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`/* unclosed\n${R} .a { color: red; }`), /unterminated/i);
});
test('rejects unclosed string', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a { content: "unclosed; }`), /unterminated/i);
});
test('rejects unclosed block', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a { color: red;`), /unmatched/i);
});

// ─── Dangling escapes ───
test('rejects dangling escape in selector', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a\\ { color: red; }`), /dangling escape/i);
});
test('rejects dangling escape in declaration', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a { content: \\`), /dangling escape/i);
});
test('rejects dangling escape in at-rule prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@media \\`), /dangling escape/i);
});

// ─── Nested rule ───
test('rejects nested rule inside declaration block', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a { ${R} .b { color: red; } }`), /nested \{/i);
});

// ─── Selector delimiter balance (typed) ───
test('rejects unclosed ( in selector', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} :is(.a { color: red; }`), /unclosed \(/i);
});
test('rejects unclosed [ in selector', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} [attr { color: red; }`), /unclosed \[/i);
});
test('rejects mismatched ) underflow in selector', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a) { color: red; }`), /mismatched \)/i);
});
test('rejects mismatched ] underflow in selector', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a] { color: red; }`), /mismatched \]/i);
});
test('rejects cross-type ([)] in selector', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} :is([)] { color: red; }`), /mismatched \)/i);
});

// ─── Declaration delimiter balance (typed) ───
test('rejects mismatched ) underflow in declaration', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a { color: rgb(1,2,3)); }`), /mismatched \)/i);
});
test('rejects mismatched ] underflow in declaration', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a { content: ]; }`), /mismatched \]/i);
});
test('rejects unclosed ( in declaration', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a { color: rgb(1,2,3; }`), /unclosed \(/i);
});
test('rejects unclosed [ in declaration', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a { content: [x; }`), /unclosed \[/i);
});
test('rejects cross-type ([)] in declaration', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a { color: fn([)]; }`), /mismatched \)/i);
});

// ─── @media prelude balance (typed) ───
test('rejects unclosed ( in @media prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@media (max-width: 767px { ${R} .a { color: red; } }`), /unclosed \(/i);
});
test('rejects mismatched ) underflow in @media prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@media ()) { ${R} .a { color: red; } }`), /mismatched \)/i);
});
test('rejects unclosed [ in @media prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@media [x { ${R} .a { color: red; } }`), /unclosed \[/i);
});
test('rejects mismatched ] underflow in @media prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@media ] { ${R} .a { color: red; } }`), /mismatched \]/i);
});
test('rejects cross-type ([)] in @media prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@media ([)] { ${R} .a { color: red; } }`), /mismatched \)/i);
});

// ─── @supports prelude balance (typed) ───
test('rejects unclosed ( in @supports prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@supports (display: grid { ${R} .a { color: red; } }`), /unclosed \(/i);
});
test('rejects mismatched ) underflow in @supports prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@supports ()) { ${R} .a { color: red; } }`), /mismatched \)/i);
});
test('rejects unclosed [ in @supports prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@supports [x { ${R} .a { color: red; } }`), /unclosed \[/i);
});
test('rejects mismatched ] underflow in @supports prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@supports ] { ${R} .a { color: red; } }`), /mismatched \]/i);
});
test('rejects cross-type ([)] in @supports prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@supports ([)] { ${R} .a { color: red; } }`), /mismatched \)/i);
});

// ─── Empty preludes ───
test('rejects empty @media prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@media { ${R} .a { color: red; } }`), /empty @media prelude/i);
});
test('rejects comment-only @media prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@media /*x*/ { ${R} .a { color: red; } }`), /empty @media prelude/i);
});
test('rejects empty @supports prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@supports { ${R} .a { color: red; } }`), /empty @supports prelude/i);
});
test('rejects comment-only @supports prelude', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`@supports /*x*/ { ${R} .a { color: red; } }`), /empty @supports prelude/i);
});

// ─── Empty selectors ───
test('rejects trailing empty selector after comma', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a, { color: red; }`), /empty selector/i);
});
test('rejects leading empty selector', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`, ${R} .a { color: red; }`), /empty selector/i);
});
test('rejects consecutive empty selector', () => {
  assert.throws(() => validateLegacyCompatibilityCss(`${R} .a,, ${R} .b { color: red; }`), /empty selector/i);
});
