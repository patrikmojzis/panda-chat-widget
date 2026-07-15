/**
 * Fail-closed CSS containment validator.
 * Accepts only the narrow grammar defined in the R4 plan §4.4.
 * Returns the count of validated style selectors, or throws SyntaxError.
 */

export function validateLegacyCompatibilityCss(css, root = '.widget-settings-legacy-compat') {
  let pos = 0;
  let validatedSelectorCount = 0;

  function fail(msg) { throw new SyntaxError(`CSS containment: ${msg} at position ${pos}`); }
  function peek() { return pos < css.length ? css[pos] : ''; }
  function advance() { return css[pos++]; }

  function skipWhitespace() { while (pos < css.length && /\s/.test(css[pos])) pos++; }

  function skipComment() {
    if (css[pos] === '/' && css[pos + 1] === '*') {
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

  function scanString(quote) {
    pos++; // skip opening quote
    while (pos < css.length) {
      if (css[pos] === '\\') { pos += 2; continue; }
      if (css[pos] === quote) { pos++; return; }
      pos++;
    }
    fail(`unterminated string starting with ${quote}`);
  }

  function scanDeclarationBlock() {
    if (peek() !== '{') fail('expected {');
    pos++;
    let depth = 1;
    while (pos < css.length && depth > 0) {
      const c = css[pos];
      if (c === '/' && css[pos + 1] === '*') { skipComment(); continue; }
      if (c === '"' || c === "'") { scanString(c); continue; }
      if (c === '\\') { pos += 2; continue; }
      if (c === '(') { depth++; pos++; continue; }
      if (c === ')') { depth--; if (depth < 1) fail('unmatched )'); pos++; continue; }
      if (c === '[') { depth++; pos++; continue; }
      if (c === ']') { depth--; if (depth < 1) fail('unmatched ]'); pos++; continue; }
      if (c === '{') fail('nested { inside declaration block');
      if (c === '}') { depth--; pos++; continue; }
      pos++;
    }
    if (depth !== 0) fail('unmatched { in declaration block');
  }

  function splitSelectors(selectorText) {
    // Split on commas, honoring strings, comments, parens, brackets, escapes
    const selectors = [];
    let current = '';
    let i = 0;
    let parenDepth = 0;
    let bracketDepth = 0;
    while (i < selectorText.length) {
      const c = selectorText[i];
      if (c === '\\') { current += selectorText.slice(i, i + 2); i += 2; continue; }
      if (c === '/' && selectorText[i + 1] === '*') {
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
        current += selectorText.slice(i, j + 1);
        i = j + 1; continue;
      }
      if (c === '(') { parenDepth++; current += c; i++; continue; }
      if (c === ')') { parenDepth--; current += c; i++; continue; }
      if (c === '[') { bracketDepth++; current += c; i++; continue; }
      if (c === ']') { bracketDepth--; current += c; i++; continue; }
      if (c === ',' && parenDepth === 0 && bracketDepth === 0) {
        selectors.push(current.trim());
        current = '';
        i++; continue;
      }
      current += c;
      i++;
    }
    const last = current.trim();
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
    if (after === undefined) return true; // exact root only
    // Legal boundary after root class
    if (/[\s>+~.#:\[]/.test(after)) return true;
    // Check for escaped characters in the root itself (rejected)
    if (rootClass.includes('\\')) fail('escaped characters in root class are unsupported');
    return false;
  }

  function parseStyleRule(selectorText, rootClass) {
    const selectors = splitSelectors(selectorText);
    if (selectors.length === 0) fail('empty selector list');
    for (const sel of selectors) {
      if (!sel) fail('empty selector in list');
      if (!validateSelector(sel, rootClass)) {
        fail(`selector "${sel}" does not begin with ${rootClass}`);
      }
    }
    scanDeclarationBlock();
    validatedSelectorCount += selectors.length;
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
      const start = pos;
      let selectorText = '';
      while (pos < css.length && peek() !== '{') {
        if (peek() === '/' && css[pos + 1] === '*') { skipComment(); continue; }
        if (peek() === '"' || peek() === "'") { const q = peek(); selectorText += css.slice(start, pos); scanString(q); selectorText += css.slice(start, pos); continue; }
        if (peek() === '\\') { selectorText += css.slice(pos, pos + 2); pos += 2; continue; }
        selectorText += peek();
        pos++;
      }
      if (pos >= css.length) fail('unexpected end of input in selector');
      parseStyleRule(selectorText.trim(), rootClass);
    }
  }

  function parseAtRule(rootClass, allowedAtRules) {
    if (peek() !== '@') fail('expected @');
    const start = pos;
    pos++;
    // Read at-rule name
    let name = '';
    while (pos < css.length && /[a-zA-Z0-9-]/.test(peek())) {
      name += advance();
    }

    // Reject keyframes at any depth
    if (/^(-webkit-|-moz-)?keyframes$/i.test(name)) {
      fail(`@${name} is not allowed`);
    }

    // Only allow specific block at-rules
    if (!allowedAtRules.includes(name)) {
      fail(`@${name} is not an allowed at-rule`);
    }

    // Skip condition/prelude
    while (pos < css.length && peek() !== '{' && peek() !== ';') {
      if (peek() === '/' && css[pos + 1] === '*') { skipComment(); continue; }
      if (peek() === '"' || peek() === "'") { scanString(peek()); continue; }
      pos++;
    }

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
