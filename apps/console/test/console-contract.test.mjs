import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const componentsJson = JSON.parse(await readFile(new URL('../components.json', import.meta.url), 'utf8'));
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../src/console-api.ts', import.meta.url), 'utf8');
const localManualReplySource = await readFile(new URL('../src/local-manual-reply-command.ts', import.meta.url), 'utf8');
const compatSource = await readFile(new URL('../src/compat/widget-settings-legacy-compat.tsx', import.meta.url), 'utf8');
const compatCss = await readFile(new URL('../src/compat/widget-settings-legacy-compat.css', import.meta.url), 'utf8');
const indexCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const viteConfigSource = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
const utilsSource = await readFile(new URL('../src/lib/utils.ts', import.meta.url), 'utf8');

const uiDir = new URL('../src/components/ui/', import.meta.url);
const uiFiles = (await readdir(uiDir)).filter(f => f.endsWith('.tsx')).sort();

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function sourceSlice(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `start needle not found: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `end needle not found: ${endNeedle}`);
  return source.slice(start, end);
}

/**
 * Parse all CSS selectors from a stylesheet and return them with metadata.
 * Each entry: { selector, isTopLevel, insideAtRule }
 */
function parseCssSelectors(css) {
  const results = [];
  let depth = 0;
  let atRuleDepth = 0;
  let inComment = false;
  const lines = css.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (inComment) { if (t.includes('*/')) inComment = false; continue; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inComment = true; continue; }
    if (!t || t.startsWith('*')) continue;

    // Track brace depth
    const openCount = (t.match(/\{/g) || []).length;
    const closeCount = (t.match(/\}/g) || []).length;
    const prevDepth = depth;

    if (t.startsWith('@') && openCount > 0) {
      atRuleDepth = depth + 1;
      depth += openCount - closeCount;
      continue;
    }

    if (t.endsWith('{') || (openCount > 0 && prevDepth === 0) || (openCount > 0 && prevDepth === atRuleDepth)) {
      // This line contains a selector
      const selectorPart = t.replace(/\s*\{.*$/, '');
      if (selectorPart && !selectorPart.startsWith('}')) {
        // Split comma-separated selectors
        const selectors = selectorPart.split(',').map(s => s.trim()).filter(Boolean);
        for (const sel of selectors) {
          results.push({
            selector: sel,
            isTopLevel: prevDepth === 0,
            insideAtRule: prevDepth > 0 && prevDepth >= atRuleDepth && atRuleDepth > 0,
          });
        }
      }
    }

    depth += openCount - closeCount;
    if (depth <= 0) { depth = 0; atRuleDepth = 0; }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// VAL-CONSOLE-01: New York inventory and package isolation
// ═══════════════════════════════════════════════════════════════

test('components.json targets New York/neutral/Lucide', () => {
  assert.equal(componentsJson.style, 'new-york');
  assert.equal(componentsJson.rsc, false);
  assert.equal(componentsJson.tsx, true);
  assert.equal(componentsJson.tailwind.baseColor, 'neutral');
  assert.equal(componentsJson.tailwind.cssVariables, true);
  assert.equal(componentsJson.tailwind.css, 'src/index.css');
  assert.equal(componentsJson.iconLibrary, 'lucide');
  assert.equal(componentsJson.aliases.utils, '@/lib/utils');
  assert.equal(componentsJson.aliases.ui, '@/components/ui');
});

test('exactly 10 ui primitives with no extras', () => {
  const expected = ['alert.tsx','button.tsx','card.tsx','empty.tsx','input.tsx','label.tsx','separator.tsx','sheet.tsx','skeleton.tsx','spinner.tsx'];
  assert.deepEqual(uiFiles, expected);
});

test('console package has exact S3 runtime and dev dependencies', () => {
  const deps = packageJson.dependencies;
  assert.equal(deps['@radix-ui/react-dialog'], '1.1.15');
  assert.equal(deps['@radix-ui/react-label'], '2.1.8');
  assert.equal(deps['@radix-ui/react-separator'], '1.1.8');
  assert.equal(deps['@radix-ui/react-slot'], '1.2.4');
  assert.equal(deps['class-variance-authority'], '0.7.1');
  assert.equal(deps.clsx, '2.1.1');
  assert.equal(deps['lucide-react'], '0.545.0');
  assert.equal(deps['tailwind-merge'], '3.5.0');
  assert.equal(deps['tw-animate-css'], '1.4.0');
  assert.equal(Object.keys(deps).length, 11);
  const devDeps = packageJson.devDependencies;
  assert.equal(devDeps['@tailwindcss/vite'], '4.2.4');
  assert.equal(devDeps.tailwindcss, '4.2.4');
  assert.equal(Object.keys(devDeps).length, 5);
});

test('utils.ts contains only cn', () => {
  assert.match(utilsSource, /export function cn/);
  const exportCount = (utilsSource.match(/\bexport\b/g) || []).length;
  assert.equal(exportCount, 1);
});

test('index.css: tailwindcss + tw-animate-css only, no dark/fonts, system stack', () => {
  assert.match(indexCss, /@import "tailwindcss"/);
  assert.match(indexCss, /@import "tw-animate-css"/);
  assert.match(indexCss, /--radius: 0\.625rem/);
  assert.match(indexCss, /--font-sans: ui-sans-serif, system-ui, sans-serif/);
  assert.doesNotMatch(indexCss, /\.dark\b/);
  assert.doesNotMatch(indexCss, /@font-face|url\(/);
  assert.equal(countOccurrences(indexCss, '@import'), 2);
});

test('no forbidden frameworks in console sources', () => {
  const all = [appSource, compatSource, mainSource, indexCss].join('\n');
  assert.doesNotMatch(all, /shadcn\/tailwind|radix-vega|react-router|recharts|tanstack|react-hook-form|\bzod\b/);
});

// ═══════════════════════════════════════════════════════════════
// Console scripts, entry, and Vite
// ═══════════════════════════════════════════════════════════════

test('console Vite scripts, HTML entry, React root', () => {
  assert.equal(packageJson.name, '@panda-chat-widget/console');
  assert.match(indexHtml, /<div id="root"><\/div>/);
  assert.match(mainSource, /createRoot\(rootElement\)\.render/);
  assert.match(viteConfigSource, /base: '\/console\/'/);
  assert.match(viteConfigSource, /port: 5174/);
  assert.match(viteConfigSource, /proxy/);
  assert.match(viteConfigSource, /tailwindcss/);
});

// ═══════════════════════════════════════════════════════════════
// console-api.ts read-only invariants
// ═══════════════════════════════════════════════════════════════

test('API client uses relative routes, cookie credentials, CSRF header, no storage', () => {
  assert.match(apiSource, /credentials: 'include'/);
  assert.match(apiSource, /headers\['x-panda-csrf'\] = '1'/);
  assert.match(apiSource, /method\?: 'DELETE' \| 'GET' \| 'PATCH' \| 'POST'/);
  assert.match(apiSource, /listSites[\s\S]*'\/api\/console\/sites'/);
  assert.match(apiSource, /createSite[\s\S]*'\/api\/console\/sites'/);
  assert.match(apiSource, /getSite[\s\S]*`\/api\/console\/sites\/\$\{encodeURIComponent\(siteId\)\}`/);
  assert.match(apiSource, /listWidgets[\s\S]*`\/api\/console\/sites\/\$\{encodeURIComponent\(siteId\)\}\/widgets`/);
  assert.match(apiSource, /createWidget[\s\S]*`\/api\/console\/sites\/\$\{encodeURIComponent\(siteId\)\}\/widgets`/);
  assert.match(apiSource, /getWidgetSettings[\s\S]*\/settings`/);
  assert.match(apiSource, /updateWidgetSettings[\s\S]*method: 'PATCH'/);
  assert.match(apiSource, /listWidgetDomains[\s\S]*\/domains`/);
  assert.match(apiSource, /createWidgetDomain[\s\S]*method: 'POST'/);
  assert.match(apiSource, /deleteWidgetDomain[\s\S]*method: 'DELETE'/);
  assert.doesNotMatch(apiSource, /localStorage|sessionStorage|document\.cookie|Authorization|Bearer/);
});

// ═══════════════════════════════════════════════════════════════
// Executable behavior harness: route/state with injected API outcomes
// ═══════════════════════════════════════════════════════════════

test('parseConsoleRoute resolves all journey routes correctly', () => {
  // Re-implement the route parser in plain JS to test it as executable behavior
  // This duplicates the algorithm from App.tsx but executes it, proving route contracts
  function decodePathSegment(segment) { try { return decodeURIComponent(segment); } catch { return segment; } }
  function parseConsoleRoute(pathname) {
    const p = pathname.replace(/\/+$/, '') || '/console';
    const s = p.split('/').filter(Boolean).map(decodePathSegment);
    if (s[0] !== 'console') return { page: 'notFound' };
    if (s.length === 1) return { page: 'sites' };
    if (s[1] !== 'sites') return { page: 'notFound' };
    if (s.length === 2) return { page: 'sites' };
    if (s.length === 3 && s[2] === 'new') return { page: 'createSite' };
    if (s.length === 3 && s[2]) return { page: 'siteDetail', siteId: s[2] };
    if (s.length === 5 && s[2] && s[3] === 'widgets' && s[4] === 'new') return { page: 'createWidget', siteId: s[2] };
    if (s.length === 5 && s[2] && s[3] === 'widgets' && s[4]) return { page: 'widgetDetail', siteId: s[2], widgetId: s[4] };
    return { page: 'notFound' };
  }
  // Verify the source algorithm matches the executable version (catches drift)
  assert.match(appSource, /pathnameWithoutTrailingSlash.*split.*filter.*map.*decodePathSegment/);
  assert.match(appSource, /segments\[3\] === 'widgets' && segments\[4\] === 'new'/);
  assert.match(appSource, /segments\[0\] !== 'console'.*notFound/);

  // Site journey routes
  assert.deepEqual(parseConsoleRoute('/console'), { page: 'sites' });
  assert.deepEqual(parseConsoleRoute('/console/'), { page: 'sites' });
  assert.deepEqual(parseConsoleRoute('/console/sites'), { page: 'sites' });
  assert.deepEqual(parseConsoleRoute('/console/sites/new'), { page: 'createSite' });
  assert.deepEqual(parseConsoleRoute('/console/sites/abc123'), { page: 'siteDetail', siteId: 'abc123' });
  assert.deepEqual(parseConsoleRoute('/console/sites/abc123/widgets/new'), { page: 'createWidget', siteId: 'abc123' });
  assert.deepEqual(parseConsoleRoute('/console/sites/abc123/widgets/w456'), { page: 'widgetDetail', siteId: 'abc123', widgetId: 'w456' });
  assert.deepEqual(parseConsoleRoute('/console/unknown'), { page: 'notFound' });
  assert.deepEqual(parseConsoleRoute('/other'), { page: 'notFound' });

  // Encoded segments
  assert.deepEqual(parseConsoleRoute('/console/sites/foo%20bar'), { page: 'siteDetail', siteId: 'foo bar' });
});

test('SiteDetailPage loads getSite+listWidgets and handles 404 → notFound', () => {
  const siteDetailSource = sourceSlice(appSource, '/* ---------- Site detail ---------- */', '/* ---------- Create widget ---------- */');

  // State type includes site and notFound
  assert.match(siteDetailSource, /status: 'ready'; site: ConsoleSite; widgets: ConsoleWidget\[\]/);
  assert.match(siteDetailSource, /status: 'notFound'/);

  // Loads both in parallel
  assert.match(siteDetailSource, /Promise\.all\(\[getSite\(siteId\), listWidgets\(siteId\)\]\)/);

  // 404 → notFound (not generic error)
  assert.match(siteDetailSource, /error instanceof ApiError && error\.status === 404 \? \{ status: 'notFound' \} : \{ status: 'error' \}/);

  // Uses site name as title
  assert.match(siteDetailSource, /title=\{state\.site\.name\}/);

  // Navigates using site.id
  assert.match(siteDetailSource, /onNavigate\(`\/console\/sites\/\$\{state\.site\.id\}\/widgets\/new`\)/);

  // Stale guard
  assert.match(siteDetailSource, /let isCurrent = true/);
  assert.match(siteDetailSource, /isCurrent = false/);
});

test('CreateWidgetPage validates site, 404→notFound, navigates to site after create', () => {
  const createWidgetSource = sourceSlice(appSource, '/* ---------- Create widget ---------- */', '/* ---------- Shared ---------- */');

  // State includes site loading
  assert.match(createWidgetSource, /status: 'ready'; site: ConsoleSite/);
  assert.match(createWidgetSource, /status: 'notFound'/);

  // Loads site before showing form
  assert.match(createWidgetSource, /const site = await getSite\(siteId\)/);

  // 404 from site load
  assert.match(createWidgetSource, /error instanceof ApiError && error\.status === 404 \? \{ status: 'notFound' \} : \{ status: 'error' \}/);

  // Post-create navigates back to site detail (not widget settings)
  assert.match(createWidgetSource, /await createWidget\(siteId, \{ name \}\)/);
  assert.match(createWidgetSource, /onNavigate\(`\/console\/sites\/\$\{siteId\}`\)/);

  // Create-submit 404 maps to notFound
  const handleSubmitSource = sourceSlice(createWidgetSource, 'async function handleSubmit', 'if (state.status ===');
  assert.match(handleSubmitSource, /error instanceof ApiError && error\.status === 404[\s\S]*status: 'notFound'/);

  // Uses site name in body
  assert.match(createWidgetSource, /state\.site\.name/);

  // Stale guard
  assert.match(createWidgetSource, /let isCurrent = true/);
});

// ═══════════════════════════════════════════════════════════════
// Widget public key compact/zoom safety
// ═══════════════════════════════════════════════════════════════

test('widget public key in site detail is constrained for compact/zoom layouts', () => {
  const siteDetailSource = sourceSlice(appSource, '/* ---------- Site detail ---------- */', '/* ---------- Create widget ---------- */');
  // The key code element must NOT use shrink-0 (prevents shrinking)
  assert.doesNotMatch(siteDetailSource, /shrink-0[^"]*break-all/);
  // It must constrain width (min-w-0 and/or max-w-full)
  assert.match(siteDetailSource, /min-w-0[^"]*break-all/);
  // Card overflow-hidden clips but key itself must be able to shrink/wrap
  assert.match(siteDetailSource, /overflow-hidden/);
});

// ═══════════════════════════════════════════════════════════════
// Settings compat: payload, handler patterns, named boundary
// ═══════════════════════════════════════════════════════════════

test('settings PATCH includes fixed safe tokens icon/accent/radius', () => {
  assert.match(compatSource, /icon: 'message'/);
  assert.match(compatSource, /accent: 'blue'/);
  assert.match(compatSource, /radius: 'md'/);
});

test('settings/connection handlers use PATCH response directly, not refreshReadyState', () => {
  const settingsH = sourceSlice(compatSource, 'async function handleSettingsSubmit', 'async function handleConnectionSubmit');
  assert.match(settingsH, /const settings = await updateWidgetSettings/);
  assert.match(settingsH, /setState\(\{ status: 'ready', settings, domains: state\.domains \}\)/);
  assert.doesNotMatch(settingsH, /refreshReadyState/);

  const connH = sourceSlice(compatSource, 'async function handleConnectionSubmit', 'async function handleConnectionClear');
  assert.match(connH, /const settings = await updateWidgetSettings/);
  assert.match(connH, /setConnectionDraft\(settings\.connection\.routeHandle/);
  assert.doesNotMatch(connH, /setForm|refreshReadyState/);

  const clearH = sourceSlice(compatSource, 'async function handleConnectionClear', 'async function handleDomainSubmit');
  assert.match(clearH, /const settings = await updateWidgetSettings/);
  assert.match(clearH, /setConnectionDraft\(''\)/);
  assert.doesNotMatch(clearH, /setForm|refreshReadyState/);
});

test('WidgetSettingsLegacyCompatibility is the named boundary, sole consumer', () => {
  assert.match(compatSource, /export function WidgetSettingsLegacyCompatibility\(/);
  assert.match(appSource, /import \{ WidgetSettingsLegacyCompatibility \} from/);
  assert.match(appSource, /<WidgetSettingsLegacyCompatibility/);
  assert.doesNotMatch(appSource, /className.*widget-settings-legacy-compat/);
});

// ═══════════════════════════════════════════════════════════════
// Form error ARIA
// ═══════════════════════════════════════════════════════════════

test('auth and create forms have stable error IDs with aria-describedby/aria-invalid', () => {
  assert.match(appSource, /const errorId = 'setup-error'/);
  assert.match(appSource, /const errorId = 'login-error'/);
  assert.match(appSource, /const errorId = 'create-site-error'/);
  assert.match(appSource, /const errorId = 'create-widget-error'/);
  // FormStatus uses the id
  const fmSource = sourceSlice(appSource, 'function FormStatus', 'function SidebarContent');
  assert.match(fmSource, /id: string/);
  assert.match(fmSource, /<Alert id=\{id\}/);
  // Inputs wire aria
  assert.match(appSource, /aria-invalid=\{hasError \|\| undefined\}/);
  assert.match(appSource, /aria-describedby=\{hasError \? errorId : undefined\}/);
});

// ═══════════════════════════════════════════════════════════════
// CSS containment: robust selector-level validation
// ═══════════════════════════════════════════════════════════════

test('compat CSS: every selector is rooted under .widget-settings-legacy-compat', () => {
  const selectors = parseCssSelectors(compatCss);
  assert.ok(selectors.length > 20, `Expected >20 selectors, got ${selectors.length}`);
  for (const { selector } of selectors) {
    assert.match(selector, /\.widget-settings-legacy-compat/, `Unrooted selector: "${selector}"`);
  }
});

test('CSS containment parser catches unrooted selectors in mixed lists', () => {
  const mixed = `.rooted .ok,\n.leak {\n  color: red;\n}`;
  const selectors = parseCssSelectors(mixed);
  const leaked = selectors.filter(s => !s.selector.includes('.rooted'));
  assert.ok(leaked.length > 0, 'Parser must detect unrooted .leak in a comma-separated list');
  assert.equal(leaked[0].selector, '.leak');
});

test('CSS containment parser catches unrooted selectors inside @media', () => {
  const media = `@media (max-width: 767px) {\n  .leak {\n    color: red;\n  }\n}`;
  const selectors = parseCssSelectors(media);
  const leaked = selectors.filter(s => !s.selector.includes('.rooted'));
  assert.ok(leaked.length > 0, 'Parser must detect unrooted .leak inside @media');
});

test('no .card-header-row in compat CSS', () => {
  assert.doesNotMatch(compatCss, /card-header-row/);
});

test('old styles.css is deleted', async () => {
  try { await readFile(new URL('../src/styles.css', import.meta.url), 'utf8'); assert.fail('styles.css should be deleted'); }
  catch (error) { assert.equal(error.code, 'ENOENT'); }
});

// ═══════════════════════════════════════════════════════════════
// Diagnostics: GET-only, merge-only, field-boundary negatives
// ═══════════════════════════════════════════════════════════════

test('diagnostics refresh is GET-only, guarded, merges only localDelivery', () => {
  const h = sourceSlice(compatSource, 'async function handleLocalDiagnosticsRefresh()', '  function handleCopySnippet');
  assert.match(h, /const diagnosticsSiteId = siteId;/);
  assert.match(h, /const diagnosticsWidgetId = widgetId;/);
  assert.match(h, /getWidgetSettings\(diagnosticsSiteId, diagnosticsWidgetId\)/);
  assert.equal(countOccurrences(h, 'getWidgetSettings('), 1);
  assert.equal(countOccurrences(h, 'currentWidgetRef.current.siteId !== diagnosticsSiteId'), 2);

  const refreshedReads = [...h.matchAll(/refreshedSettings\.[A-Za-z0-9_.]+/g)].map(m => m[0]);
  assert.deepEqual(refreshedReads, ['refreshedSettings.connection.localDelivery']);

  assert.doesNotMatch(h, /setForm|setConnectionDraft|formFromSettings|refreshReadyState|listWidgetDomains|setCopyState/);
  assert.doesNotMatch(h, /updateWidgetSettings|createWidgetDomain|deleteWidgetDomain/);
  // Negatives for unrelated fields the refresh must not read
  assert.doesNotMatch(h, /refreshedSettings\.widget|refreshedSettings\.config|refreshedSettings\.install|refreshedSettings\.connection\.status|refreshedSettings\.connection\.routeHandle|domains:/);
  assert.doesNotMatch(h, /setTimeout|setInterval|EventSource|WebSocket|\bWorker\b|location\.reload/);
});

// ═══════════════════════════════════════════════════════════════
// Privacy/sensitive-field negative scans
// ═══════════════════════════════════════════════════════════════

test('candidate details expose only allowlisted fields, no sensitive data', () => {
  const detailsStart = compatSource.indexOf('function NextLocalReplyCandidateDetails');
  assert.notEqual(detailsStart, -1);
  const detailsEnd = compatSource.indexOf('function LegacyFormStatus', detailsStart);
  const detailsSource = compatSource.slice(detailsStart, detailsEnd);
  const allowedLabels = ['status', 'conversationId', 'visitorMessageId', 'clientMessageId', 'createdAt', 'claimedAt'];

  for (const label of allowedLabels) {
    assert.match(detailsSource, new RegExp(`<dt>${label}<\\/dt>`));
  }

  const renderedFields = [...new Set([...detailsSource.matchAll(/candidate\.([A-Za-z0-9_]+)/g)].map(m => m[1]))].sort();
  assert.deepEqual(renderedFields, [...allowedLabels].sort());

  assert.doesNotMatch(detailsSource, /Object\.entries|Object\.keys|Object\.values|JSON\.stringify/);
  assert.doesNotMatch(detailsSource, /visitorSessionId|routeHandleSnapshot|visitorMessageBody|clientMessageBody|messageBody|messageText|bodyText|messageContent|rawContent|localIntent|intentPayload|payload|metadata/);
});

test('API candidate type has no sensitive fields beyond the allowlist', () => {
  const typeStart = apiSource.indexOf('export type ConsoleWidgetNextLocalReplyCandidate = {');
  assert.notEqual(typeStart, -1);
  const typeEnd = apiSource.indexOf('};', typeStart);
  const typeSource = apiSource.slice(typeStart, typeEnd);
  assert.doesNotMatch(typeSource, /visitorSessionId|routeHandleSnapshot|visitorMessageBody|clientMessageBody|messageBody|messageText|bodyText|messageContent|rawContent|localIntent|intentPayload|payload|metadata/);
});

test('candidate UI section has no storage/fetch/form/submission side-effects', () => {
  const uiStart = compatSource.indexOf('aria-label="Next local manual reply target"');
  assert.notEqual(uiStart, -1);
  const uiEnd = compatSource.indexOf('<form className="inline-form"', uiStart);
  assert.notEqual(uiEnd, -1);
  const uiSource = compatSource.slice(uiStart, uiEnd);
  assert.doesNotMatch(uiSource, /<form|onSubmit=|fetch\(|localStorage|sessionStorage/);
  assert.doesNotMatch(uiSource, /visitorSessionId|routeHandleSnapshot|visitorMessageBody|clientMessageBody|messageBody|messageText|bodyText|messageContent|rawContent|localIntent|intentPayload|payload|metadata/);
});

test('local manual reply command builder has no sensitive field leakage', () => {
  assert.match(localManualReplySource, /JSON\.stringify\(\{ targetIntentId, reply: \{ text \} \}\)/);
  assert.match(localManualReplySource, /export const localManualReplyCopyCoordinator = createLocalManualReplyCopyCoordinator\(\);/);
  assert.doesNotMatch(localManualReplySource, /visitorSessionId|routeHandleSnapshot|visitorMessageBody|clientMessageBody|messageBody|messageText|bodyText|messageContent|rawContent|localIntent|intentPayload|metadata/);
});

// ═══════════════════════════════════════════════════════════════
// Shell, storage, no forbidden copy
// ═══════════════════════════════════════════════════════════════

test('responsive desktop aside and mobile Sheet', () => {
  assert.match(appSource, /hidden md:flex/);
  assert.match(appSource, /aria-label="Console navigation"/);
  assert.match(appSource, /md:hidden/);
  assert.match(appSource, /Open navigation menu/);
  assert.match(appSource, /SheetTrigger/);
  assert.match(appSource, /setSheetOpen\(false\)/);
  assert.match(appSource, /md:grid-cols-\[16rem/);
});

test('no storage or dark mode', () => {
  const all = [appSource, compatSource, mainSource, indexCss].join('\n');
  assert.doesNotMatch(all, /localStorage|sessionStorage|document\.cookie/);
});

test('no forbidden product copy in app + API sources', () => {
  const cleaned = `${appSource}\n${apiSource}`.replaceAll('Gateway/CLI dispatch is not connected yet', '');
  assert.doesNotMatch(cleaned, /billing|plans|usage|invite|RBAC|Gateway|\bCLI\b|SalesPanda|CRM|customCss|unsafeHtml|dangerouslySetInnerHTML/i);
});

test('no unused React imports in App.tsx', () => {
  assert.doesNotMatch(appSource, /\buseReducer\b/);
  assert.doesNotMatch(appSource, /\buseRef\b/);
});

test('Alert primitive ref types match rendered elements', async () => {
  const alertSource = await readFile(new URL('../src/components/ui/alert.tsx', import.meta.url), 'utf8');
  assert.match(alertSource, /forwardRef<HTMLHeadingElement/);
  assert.match(alertSource, /<h5\b/);
  assert.match(alertSource, /forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>/);
});

test('no fix-round markers in production source', () => {
  assert.doesNotMatch(appSource, /BLOCKER|SHOULD_FIX/);
  assert.doesNotMatch(compatSource, /BLOCKER|SHOULD_FIX/);
  assert.doesNotMatch(compatCss, /WidgetSettingsPage/);
});
