/**
 * Fail-closed CSS containment validator.
 * Accepts only the narrow grammar: rooted style rules, @media/@supports blocks,
 * comments, strings, and escapes. Rejects everything else.
 * Returns the count of validated style selectors, or throws SyntaxError.
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
    // pos is at backslash
    if (pos + 1 >= css.length) fail('dangling escape at end of input');
    pos += 2;
  }

  function scanString(quote) {
    pos++; // skip opening quote
    while (pos < css.length) {
      if (css[pos] === '\\') { scanEscape(); continue; }
      if (css[pos] === quote) { pos++; return; }
      pos++;
    }
    fail(`unterminated string starting with ${quote}`);
  }

  /**
   * Scan a balanced block of declarations: { ... }
   * Tracks parentheses () and brackets [] with typed depth.
   * Rejects nested { } (which would be a nested rule).
   */
  function scanDeclarationBlock() {
    if (peek() !== '{') fail('expected {');
    pos++;
    let parenDepth = 0;
    let bracketDepth = 0;
    while (pos < css.length) {
      const c = css[pos];
      if (c === '/' && pos + 1 < css.length && css[pos + 1] === '*') { skipComment(); continue; }
      if (c === '"' || c === "'") { scanString(c); continue; }
      if (c === '\\') { scanEscape(); continue; }
      if (c === '(') { parenDepth++; pos++; continue; }
      if (c === ')') {
        if (parenDepth <= 0) fail('mismatched ) in declaration block');
        parenDepth--; pos++; continue;
      }
      if (c === '[') { bracketDepth++; pos++; continue; }
      if (c === ']') {
        if (bracketDepth <= 0) fail('mismatched ] in declaration block');
        bracketDepth--; pos++; continue;
      }
      if (c === '{') fail('nested { inside declaration block');
      if (c === '}') {
        if (parenDepth !== 0) fail('unclosed ( in declaration block');
        if (bracketDepth !== 0) fail('unclosed [ in declaration block');
        pos++;
        return;
      }
      pos++;
    }
    fail('unmatched { in declaration block');
  }

  /**
   * Split selector text on commas, honoring strings, comments, parens, brackets, escapes.
   * Rejects empty selectors (trailing/leading/consecutive commas).
   */
  function splitSelectors(selectorText) {
    const selectors = [];
    let current = '';
    let i = 0;
    let parenDepth = 0;
    let bracketDepth = 0;
    while (i < selectorText.length) {
      const c = selectorText[i];
      if (c === '\\') {
        if (i + 1 >= selectorText.length) fail('dangling escape in selector');
        current += selectorText.slice(i, i + 2);
        i += 2;
        continue;
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
      if (c === '(') { parenDepth++; current += c; i++; continue; }
      if (c === ')') {
        if (parenDepth <= 0) fail('mismatched ) in selector');
        parenDepth--; current += c; i++; continue;
      }
      if (c === '[') { bracketDepth++; current += c; i++; continue; }
      if (c === ']') {
        if (bracketDepth <= 0) fail('mismatched ] in selector');
        bracketDepth--; current += c; i++; continue;
      }
      if (c === ',' && parenDepth === 0 && bracketDepth === 0) {
        const trimmed = current.trim();
        if (!trimmed) fail('empty selector in list');
        selectors.push(trimmed);
        current = '';
        i++; continue;
      }
      current += c;
      i++;
    }
    if (parenDepth !== 0) fail('unclosed ( in selector');
    if (bracketDepth !== 0) fail('unclosed [ in selector');
    const last = current.trim();
    if (!last && selectors.length > 0) fail('empty selector after trailing comma');
    if (last) selectors.push(last);
    return selectors;
  }

  function validateSelector(selector, rootClass) {
    // Strip leading comments/whitespace
    let s = selector;
    while (true) {
      const before = s;
      s = s.replace(/^\s+/, '');
      s = s.replace(/^\/\*[\s\S]*?\*\//, '');
      if (s === before) break;
    }
    if (!s) return false;

    // Must start with the exact root class
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

  /**
   * Scan an at-rule prelude (the part between @name and {).
   * Tracks typed parens and brackets for balance.
   */
  function scanAtRulePrelude() {
    let parenDepth = 0;
    let bracketDepth = 0;
    while (pos < css.length) {
      const c = css[pos];
      if (c === '{') {
        if (parenDepth !== 0) fail('unclosed ( in at-rule prelude');
        if (bracketDepth !== 0) fail('unclosed [ in at-rule prelude');
        return;
      }
      if (c === ';') return;
      if (c === '/' && pos + 1 < css.length && css[pos + 1] === '*') { skipComment(); continue; }
      if (c === '"' || c === "'") { scanString(css[pos]); continue; }
      if (c === '\\') { scanEscape(); continue; }
      if (c === '(') { parenDepth++; pos++; continue; }
      if (c === ')') {
        if (parenDepth <= 0) fail('mismatched ) in at-rule prelude');
        parenDepth--; pos++; continue;
      }
      if (c === '[') { bracketDepth++; pos++; continue; }
      if (c === ']') {
        if (bracketDepth <= 0) fail('mismatched ] in at-rule prelude');
        bracketDepth--; pos++; continue;
      }
      pos++;
    }
    fail('unexpected end of input in at-rule prelude');
  }

  function parseBlockContents(rootClass, allowedAtRules) {
    while (pos < css.length) {
      skipWhitespaceAndComments();
      if (pos >= css.length) break;
      if (peek() === '}') break;

      if (peek() === '@') {
        parseAtRule(rootClass, allowedAtRules);
        continue;
      }

      // Read selector text until {
      let selectorText = '';
      while (pos < css.length && peek() !== '{') {
        const c = css[pos];
        if (c === '/' && pos + 1 < css.length && css[pos + 1] === '*') {
          skipComment(); continue;
        }
        if (c === '"' || c === "'") {
          const start = pos;
          scanString(c);
          selectorText += css.slice(start, pos);
          continue;
        }
        if (c === '\\') {
          if (pos + 1 >= css.length) fail('dangling escape in selector');
          selectorText += css.slice(pos, pos + 2);
          pos += 2;
          continue;
        }
        selectorText += c;
        pos++;
      }
      if (pos >= css.length) fail('unexpected end of input in selector');
      parseStyleRule(selectorText.trim(), rootClass);
    }
  }

  function parseAtRule(rootClass, allowedAtRules) {
    if (peek() !== '@') fail('expected @');
    pos++;
    let name = '';
    while (pos < css.length && /[a-zA-Z0-9-]/.test(peek())) {
      name += css[pos++];
    }

    if (/^(-webkit-|-moz-)?keyframes$/i.test(name)) {
      fail(`@${name} is not allowed`);
    }

    if (!allowedAtRules.includes(name)) {
      fail(`@${name} is not an allowed at-rule`);
    }

    scanAtRulePrelude();

    if (peek() === ';') fail(`statement @${name} is not allowed`);
    if (peek() !== '{') fail(`expected { after @${name}`);
    pos++; // skip {

    parseBlockContents(rootClass, allowedAtRules);

    skipWhitespaceAndComments();
    if (peek() !== '}') fail(`expected } to close @${name}`);
    pos++;
  }

  const allowedAtRules = ['media', 'supports'];
  parseBlockContents(root, allowedAtRules);

  skipWhitespaceAndComments();
  if (pos < css.length) fail(`unexpected content at end: ${css.slice(pos, pos + 20)}`);

  return validatedSelectorCount;
}
