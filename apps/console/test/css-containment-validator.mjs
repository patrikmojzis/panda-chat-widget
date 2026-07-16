/**
 * Fail-closed CSS containment validator (test-only).
 * Typed delimiter stacks, nonempty allowed preludes, no dependencies.
 * Returns validated selector count or throws SyntaxError.
 */

export function validateLegacyCompatibilityCss(css, root = '.widget-settings-legacy-compat') {
  let pos = 0;
  let validatedSelectorCount = 0;

  function fail(msg) { throw new SyntaxError(`CSS containment: ${msg} at position ${pos}`); }
  function peek() { return pos < css.length ? css[pos] : ''; }

  function skipWhitespace() { while (pos < css.length && /\s/.test(css[pos])) pos++; }

  function skipComment() {
    if (pos < css.length - 1 && css[pos] === '/' && css[pos + 1] === '*') {
      pos += 2;
      while (pos < css.length - 1) {
        if (css[pos] === '*' && css[pos + 1] === '/') { pos += 2; return true; }
        pos++;
      }
      fail('unterminated comment');
    }
    return false;
  }

  function skipWhitespaceAndComments() {
    while (pos < css.length) {
      skipWhitespace();
      if (!skipComment()) break;
    }
  }

  function scanEscape() {
    if (pos + 1 >= css.length) fail('dangling escape at end of input');
    pos += 2;
  }

  function scanString(quote) {
    pos++;
    while (pos < css.length) {
      if (css[pos] === '\\') { scanEscape(); continue; }
      if (css[pos] === quote) { pos++; return; }
      pos++;
    }
    fail(`unterminated string starting with ${quote}`);
  }

  const OPENERS = { '(': ')', '[': ']' };
  const CLOSERS = { ')': '(', ']': '[' };

  function pushDelim(stack, c, context) {
    stack.push(c);
  }

  function popDelim(stack, c, context) {
    const expected = CLOSERS[c];
    if (stack.length === 0) fail(`mismatched ${c} in ${context}`);
    if (stack[stack.length - 1] !== expected) fail(`mismatched ${c} in ${context} (expected ${OPENERS[stack[stack.length - 1]]})`);
    stack.pop();
  }

  function requireEmpty(stack, context) {
    if (stack.length > 0) {
      const top = stack[stack.length - 1];
      fail(`unclosed ${top} in ${context}`);
    }
  }

  function scanDeclarationBlock() {
    if (peek() !== '{') fail('expected {');
    pos++;
    const stack = [];
    while (pos < css.length) {
      const c = css[pos];
      if (c === '/' && pos + 1 < css.length && css[pos + 1] === '*') { skipComment(); continue; }
      if (c === '"' || c === "'") { scanString(c); continue; }
      if (c === '\\') { scanEscape(); continue; }
      if (c === '(' || c === '[') { pushDelim(stack, c, 'declaration block'); pos++; continue; }
      if (c === ')' || c === ']') { popDelim(stack, c, 'declaration block'); pos++; continue; }
      if (c === '{') fail('nested { inside declaration block');
      if (c === '}') { requireEmpty(stack, 'declaration block'); pos++; return; }
      pos++;
    }
    fail('unmatched { in declaration block');
  }

  function splitSelectors(selectorText) {
    const selectors = [];
    let current = '';
    let i = 0;
    const stack = [];
    while (i < selectorText.length) {
      const c = selectorText[i];
      if (c === '\\') {
        if (i + 1 >= selectorText.length) fail('dangling escape in selector');
        current += selectorText.slice(i, i + 2);
        i += 2; continue;
      }
      if (c === '/' && i + 1 < selectorText.length && selectorText[i + 1] === '*') {
        const end = selectorText.indexOf('*/', i + 2);
        if (end === -1) fail('unterminated comment in selector');
        i = end + 2; continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < selectorText.length) {
          if (selectorText[j] === '\\') { j += 2; continue; }
          if (selectorText[j] === c) break;
          j++;
        }
        if (j >= selectorText.length) fail('unterminated string in selector');
        current += selectorText.slice(i, j + 1);
        i = j + 1; continue;
      }
      if (c === '(' || c === '[') { stack.push(c); current += c; i++; continue; }
      if (c === ')' || c === ']') {
        const expected = CLOSERS[c];
        if (stack.length === 0) fail(`mismatched ${c} in selector`);
        if (stack[stack.length - 1] !== expected) fail(`mismatched ${c} in selector`);
        stack.pop();
        current += c; i++; continue;
      }
      if (c === ',' && stack.length === 0) {
        const trimmed = current.trim();
        if (!trimmed) fail('empty selector in list');
        selectors.push(trimmed);
        current = ''; i++; continue;
      }
      current += c; i++;
    }
    if (stack.length > 0) fail(`unclosed ${stack[stack.length - 1]} in selector`);
    const last = current.trim();
    if (!last && selectors.length > 0) fail('empty selector after trailing comma');
    if (last) selectors.push(last);
    return selectors;
  }

  function validateSelector(selector, rootClass) {
    let s = selector;
    while (true) {
      const before = s;
      s = s.replace(/^\s+/, '');
      s = s.replace(/^\/\*[\s\S]*?\*\//, '');
      if (s === before) break;
    }
    if (!s) return false;
    if (!s.startsWith(rootClass)) return false;
    const after = s[rootClass.length];
    if (after === undefined) return true;
    if (/[\s>+~.#:\[]/.test(after)) return true;
    return false;
  }

  function parseStyleRule(selectorText, rootClass) {
    const selectors = splitSelectors(selectorText);
    if (selectors.length === 0) fail('empty selector list');
    for (const sel of selectors) {
      if (!validateSelector(sel, rootClass)) {
        fail(`unrooted selector: "${sel}" does not begin with ${rootClass}`);
      }
    }
    scanDeclarationBlock();
    validatedSelectorCount += selectors.length;
  }

  function scanAtRulePrelude(atName) {
    const stack = [];
    let hasContent = false;
    while (pos < css.length) {
      const c = css[pos];
      if (c === '{' || c === ';') {
        requireEmpty(stack, `@${atName} prelude`);
        if (!hasContent) fail(`empty @${atName} prelude`);
        return;
      }
      if (c === '/' && pos + 1 < css.length && css[pos + 1] === '*') { skipComment(); continue; }
      if (c === '"' || c === "'") { hasContent = true; scanString(css[pos]); continue; }
      if (c === '\\') { hasContent = true; scanEscape(); continue; }
      if (c === '(' || c === '[') { hasContent = true; stack.push(c); pos++; continue; }
      if (c === ')' || c === ']') {
        hasContent = true;
        const expected = CLOSERS[c];
        if (stack.length === 0) fail(`mismatched ${c} in @${atName} prelude`);
        if (stack[stack.length - 1] !== expected) fail(`mismatched ${c} in @${atName} prelude`);
        stack.pop(); pos++; continue;
      }
      if (!/\s/.test(c)) hasContent = true;
      pos++;
    }
    fail(`unexpected end of input in @${atName} prelude`);
  }

  function parseBlockContents(rootClass, allowedAtRules) {
    while (pos < css.length) {
      skipWhitespaceAndComments();
      if (pos >= css.length) break;
      if (peek() === '}') break;
      if (peek() === '@') { parseAtRule(rootClass, allowedAtRules); continue; }

      let selectorText = '';
      while (pos < css.length && peek() !== '{') {
        const c = css[pos];
        if (c === '/' && pos + 1 < css.length && css[pos + 1] === '*') { skipComment(); continue; }
        if (c === '"' || c === "'") {
          const start = pos; scanString(c);
          selectorText += css.slice(start, pos); continue;
        }
        if (c === '\\') {
          if (pos + 1 >= css.length) fail('dangling escape in selector');
          selectorText += css.slice(pos, pos + 2); pos += 2; continue;
        }
        selectorText += c; pos++;
      }
      if (pos >= css.length) fail('unexpected end of input in selector');
      parseStyleRule(selectorText.trim(), rootClass);
    }
  }

  function parseAtRule(rootClass, allowedAtRules) {
    pos++;
    let name = '';
    while (pos < css.length && /[a-zA-Z0-9-]/.test(peek())) { name += css[pos++]; }
    if (/^(-webkit-|-moz-)?keyframes$/i.test(name)) fail(`@${name} is not allowed`);
    if (!allowedAtRules.includes(name)) fail(`@${name} is not an allowed at-rule`);
    scanAtRulePrelude(name);
    if (peek() === ';') fail(`statement @${name} is not allowed`);
    if (peek() !== '{') fail(`expected { after @${name}`);
    pos++;
    parseBlockContents(rootClass, allowedAtRules);
    skipWhitespaceAndComments();
    if (peek() !== '}') fail(`expected } to close @${name}`);
    pos++;
  }

  parseBlockContents(root, ['media', 'supports']);
  skipWhitespaceAndComments();
  if (pos < css.length) fail(`unexpected content at end: ${css.slice(pos, pos + 20)}`);
  return validatedSelectorCount;
}
