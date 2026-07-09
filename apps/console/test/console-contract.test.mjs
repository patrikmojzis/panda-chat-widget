import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../src/console-api.ts', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const viteConfigSource = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');


function sourceSlice(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1);

  return source.slice(start, end);
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

test('console package exposes Vite scripts including typecheck and check', () => {
  assert.equal(packageJson.name, '@panda-chat-widget/console');
  assert.equal(packageJson.scripts.dev, 'vite --host 127.0.0.1 --port 5174');
  assert.equal(packageJson.scripts.build, 'tsc -p tsconfig.json --noEmit --pretty false && vite build');
  assert.equal(packageJson.scripts.test, 'node --test "test/**/*.test.mjs"');
  assert.match(packageJson.scripts.typecheck, /tsc -p tsconfig\.json --noEmit --pretty false/);
  assert.equal(packageJson.scripts.check, 'pnpm typecheck && pnpm lint && pnpm test && pnpm build');
  assert.equal(packageJson.dependencies.react, '^19.2.7');
  assert.equal(packageJson.dependencies['react-dom'], '^19.2.7');
});

test('console has a Vite HTML entry and React root', () => {
  assert.match(indexHtml, /<div id="root"><\/div>/);
  assert.match(indexHtml, /type="module" src="\/src\/main\.tsx"/);
  assert.match(mainSource, /createRoot\(rootElement\)\.render/);
  assert.match(mainSource, /<StrictMode>/);
  assert.match(mainSource, /<App \/>/);
  assert.match(viteConfigSource, /base: '\/console\/'/);
  assert.match(viteConfigSource, /port: 5174/);
  assert.match(viteConfigSource, /proxy/);
});

test('console API client uses relative authenticated routes, cookie credentials, and CSRF header for unsafe calls', () => {
  assert.match(apiSource, /getCurrentContext\(\): Promise<CurrentContext> \{\n  return apiRequest\('\/api\/me'\);/);
  assert.doesNotMatch(apiSource, /apiRequest\('\/me'\)/);
  assert.match(apiSource, /setupFirstOwner[\s\S]*'\/api\/auth\/setup'/);
  assert.match(apiSource, /login[\s\S]*'\/api\/auth\/login'/);
  assert.match(apiSource, /logout[\s\S]*'\/api\/auth\/logout'/);
  assert.match(apiSource, /listSites[\s\S]*'\/api\/console\/sites'/);
  assert.match(apiSource, /createSite[\s\S]*'\/api\/console\/sites'/);
  assert.match(apiSource, /getSite[\s\S]*`\/api\/console\/sites\/\$\{encodeURIComponent\(siteId\)\}`/);
  assert.match(apiSource, /listWidgets[\s\S]*`\/api\/console\/sites\/\$\{encodeURIComponent\(siteId\)\}\/widgets`/);
  assert.match(apiSource, /createWidget[\s\S]*`\/api\/console\/sites\/\$\{encodeURIComponent\(siteId\)\}\/widgets`/);
  assert.match(apiSource, /getWidgetSettings[\s\S]*\/settings`/);
  assert.match(apiSource, /updateWidgetSettings[\s\S]*method: 'PATCH'/);
  assert.match(apiSource, /ConsoleWidgetLocalDelivery[\s\S]*queuedIntentCount: number;[\s\S]*lastQueuedAt: string \| null;[\s\S]*claimedIntentCount: number;[\s\S]*lastClaimedAt: string \| null;[\s\S]*appliedLocalReplyCount: number;[\s\S]*lastAppliedLocalReplyAt: string \| null;[\s\S]*nextLocalReplyCandidate: ConsoleWidgetNextLocalReplyCandidate \| null/);
  assert.match(apiSource, /ConsoleWidgetNextLocalReplyCandidate[\s\S]*id: string;[\s\S]*status: 'queued' \| 'claimed';[\s\S]*conversationId: string;[\s\S]*visitorMessageId: string;[\s\S]*clientMessageId: string;[\s\S]*createdAt: string;[\s\S]*claimedAt: string \| null/);
  assert.match(apiSource, /ConsoleWidgetConnection[\s\S]*routeHandle: string \| null;[\s\S]*localDelivery: ConsoleWidgetLocalDelivery/);
  assert.match(apiSource, /connection\?: \{[\s\S]*routeHandle\?: string \| null/);
  assert.match(apiSource, /listWidgetDomains[\s\S]*\/domains`/);
  assert.match(apiSource, /createWidgetDomain[\s\S]*method: 'POST'/);
  assert.match(apiSource, /deleteWidgetDomain[\s\S]*method: 'DELETE'/);
  assert.match(apiSource, /method\?: 'DELETE' \| 'GET' \| 'PATCH' \| 'POST'/);
  assert.match(apiSource, /credentials: 'include'/);
  assert.match(apiSource, /headers\['x-panda-csrf'\] = '1'/);
  assert.doesNotMatch(apiSource, /localStorage|sessionStorage|document\.cookie|Authorization|Bearer/);
});

test('console UI includes setup, login, site/widget states, and preserves authenticated deep links', () => {
  assert.match(appSource, /First owner setup/);
  assert.match(appSource, /Create your workspace/);
  assert.match(appSource, /Owner login/);
  assert.match(appSource, /Sign in to your console/);
  assert.match(appSource, /No sites yet/);
  assert.match(appSource, /Create site/);
  assert.match(appSource, /Site detail/);
  assert.match(appSource, /No widgets yet/);
  assert.match(appSource, /Create widget/);
  assert.match(appSource, /Public key/);
  assert.match(appSource, /Widget settings/);
  assert.match(appSource, /Allowed domains/);
  assert.match(appSource, /Add domain/);
  assert.match(appSource, /Install snippet/);
  assert.match(appSource, /Copy snippet/);
  assert.match(appSource, /Panda connection/);
  assert.match(appSource, /Connection placeholder/);
  assert.match(appSource, /Owner-only local deterministic fake reply diagnostic/);
  assert.match(appSource, /Gateway\/CLI dispatch is not connected yet/);
  assert.match(appSource, /Local future-dispatch queue/);
  assert.match(appSource, /Claimed locally/);
  assert.match(appSource, /claimed locally/);
  assert.match(appSource, /last claimed timestamp unavailable/);
  assert.match(appSource, /Local deterministic fake reply diagnostic/);
  assert.match(appSource, /next manual reply target ID/);
  assert.match(appSource, /Local-only targetIntentId for local-panda:reply-manual/);
  assert.match(appSource, /Copy target ID/);
  assert.match(appSource, /No next manual reply target ID/);
  assert.match(appSource, /Refresh local diagnostics/);
  assert.match(appSource, /Refreshing local diagnostics…/);
  assert.match(appSource, /Manual local\/demo-only diagnostics refreshes/);
  assert.match(appSource, /Local diagnostics could not be refreshed/);
  assert.match(appSource, /Applied locally/);
  assert.match(appSource, /fake reply applications/);
  assert.match(appSource, /last applied locally/);
  assert.match(appSource, /last applied timestamp unavailable/);
  assert.match(appSource, /local fake reply loop/);
  assert.match(appSource, /Save placeholder/);
  assert.match(appSource, /Clear connection/);
  assert.match(appSource, /widgetDetail/);
  assert.match(appSource, /parseConsoleRoute/);
  assert.match(appSource, /popstate/);
  assert.match(appSource, /if \(isAuthPath\(window\.location\.pathname\)\) \{\n\s+replaceConsolePath\('\/console'\);/);
  assert.match(appSource, /window\.history\.pushState/);
  assert.match(appSource, /role="alert"/);
  assert.match(appSource, /autoFocus/);
  const sourceWithAllowedFutureDispatchCopyRemoved = `${appSource}\n${apiSource}`
    .replaceAll('Gateway/CLI dispatch is not connected yet', '');
  assert.doesNotMatch(
    sourceWithAllowedFutureDispatchCopyRemoved,
    /billing|plans|usage|invite|RBAC|Gateway|\bCLI\b|SalesPanda|CRM|customCss|unsafeHtml|dangerouslySetInnerHTML/i,
  );
  assert.doesNotMatch(
    sourceWithAllowedFutureDispatchCopyRemoved,
    /EventSource|WebSocket|child_process|Worker|setTimeout|setInterval|dispatcher|outbound|dead-?letter|\bretry\b|\bdelivered\b|delivery failed|failed delivery|reply-?ingestion|claimNextQueuedPandaDeliveryIntent|recordPandaDeliveryIntent|panda-delivery-intents/i,
  );
});


test('console local diagnostics refresh is GET-only, guarded, and merges only local delivery', () => {
  const handlerSource = sourceSlice(
    appSource,
    'async function handleLocalDiagnosticsRefresh()',
    '  function handleCopySnippet',
  );

  assert.match(handlerSource, /const diagnosticsSiteId = siteId;/);
  assert.match(handlerSource, /const diagnosticsWidgetId = widgetId;/);
  assert.match(handlerSource, /getWidgetSettings\(diagnosticsSiteId, diagnosticsWidgetId\)/);
  assert.equal(countOccurrences(handlerSource, 'getWidgetSettings('), 1);
  assert.equal(countOccurrences(handlerSource, 'currentWidgetRef.current.siteId !== diagnosticsSiteId'), 2);
  assert.equal(countOccurrences(handlerSource, 'currentWidgetRef.current.widgetId !== diagnosticsWidgetId'), 2);
  assert.match(handlerSource, /setDiagnosticsRefreshState\('submitting'\)/);
  assert.match(handlerSource, /setDiagnosticsRefreshState\('idle'\)/);
  assert.match(handlerSource, /setDiagnosticsRefreshState\('error'\)/);

  const refreshedSettingsReads = [...handlerSource.matchAll(/refreshedSettings\.[A-Za-z0-9_.]+/g)].map((match) => match[0]);
  assert.deepEqual(refreshedSettingsReads, ['refreshedSettings.connection.localDelivery']);
  assert.match(handlerSource, /const refreshedLocalDelivery = refreshedSettings\.connection\.localDelivery/);
  assert.match(handlerSource, /localDelivery: refreshedLocalDelivery/);
  assert.match(handlerSource, /\.\.\.currentState,/);
  assert.match(handlerSource, /\.\.\.currentState\.settings,/);
  assert.match(handlerSource, /\.\.\.currentState\.settings\.connection,/);

  assert.match(handlerSource, /const refreshedCandidateId = refreshedLocalDelivery\.nextLocalReplyCandidate\?\.id \?\? null/);
  assert.match(handlerSource, /if \(currentCandidateIdRef\.current !== refreshedCandidateId\) \{\n\s+setTargetCopyState\('idle'\);\n\s+\}/);
  assert.equal(countOccurrences(handlerSource, "setTargetCopyState('idle')"), 1);

  assert.doesNotMatch(
    handlerSource,
    /setForm|setConnectionDraft|formFromSettings|refreshReadyState|listWidgetDomains|setCopyState/,
  );
  assert.doesNotMatch(
    handlerSource,
    /updateWidgetSettings|createWidgetDomain|deleteWidgetDomain|createWidget|createSite|login|logout|setupFirstOwner/,
  );
  assert.doesNotMatch(
    handlerSource,
    /refreshedSettings\.widget|refreshedSettings\.config|refreshedSettings\.install|refreshedSettings\.connection\.status|refreshedSettings\.connection\.routeHandle|domains:/,
  );
  assert.doesNotMatch(
    handlerSource,
    /setTimeout|setInterval|requestAnimationFrame|EventSource|WebSocket|\bWorker\b|location\.reload|\.reload\(|window\.location|document\.location/,
  );
});

test('console next local manual reply target exposes only allowlisted candidate details', () => {
  const detailsStart = appSource.indexOf('function NextLocalReplyCandidateDetails');
  assert.notEqual(detailsStart, -1);
  const detailsEnd = appSource.indexOf('function formatConnectionStatus', detailsStart);
  assert.notEqual(detailsEnd, -1);
  const detailsSource = appSource.slice(detailsStart, detailsEnd);
  const allowedLabels = ['status', 'conversationId', 'visitorMessageId', 'clientMessageId', 'createdAt', 'claimedAt'];

  for (const label of allowedLabels) {
    assert.match(detailsSource, new RegExp(`<dt>${label}<\\/dt>`));
    assert.match(detailsSource, new RegExp(`candidate\\.${label}`));
  }

  assert.match(detailsSource, /not claimed yet/);
  assert.doesNotMatch(detailsSource, /Object\.entries|Object\.keys|Object\.values|JSON\.stringify|for\s*\([^)]*\sin\s+candidate/);

  const renderedCandidateFields = [...new Set([...detailsSource.matchAll(/candidate\.([A-Za-z0-9_]+)/g)].map((match) => match[1]))].sort();
  assert.deepEqual(renderedCandidateFields, [...allowedLabels].sort());

  const candidateUiStart = appSource.indexOf('aria-label="Next local manual reply target"');
  assert.notEqual(candidateUiStart, -1);
  const candidateUiEnd = appSource.indexOf('<form className="inline-form"', candidateUiStart);
  assert.notEqual(candidateUiEnd, -1);
  const candidateUiSource = appSource.slice(candidateUiStart, candidateUiEnd);

  assert.match(candidateUiSource, /handleCopyNextLocalReplyTarget\(nextLocalReplyCandidate\.id\)/);
  assert.match(appSource, /navigator\.clipboard\.writeText\(intentId\)/);
  assert.match(candidateUiSource, /Local-only targetIntentId for local-panda:reply-manual\./);
  assert.match(candidateUiSource, /Copy target ID/);
  assert.match(candidateUiSource, /No next manual reply target ID/);
  assert.match(candidateUiSource, /NextLocalReplyCandidateDetails candidate=\{nextLocalReplyCandidate\}/);

  const localCandidateSources = `${candidateUiSource}\n${detailsSource}`;
  assert.doesNotMatch(localCandidateSources, /Object\.entries|Object\.keys|Object\.values|JSON\.stringify/);
  assert.doesNotMatch(
    localCandidateSources,
    /visitorSessionId|routeHandleSnapshot|visitorMessageBody|clientMessageBody|messageBody|messageText|bodyText|messageContent|rawContent|localIntent|intentPayload|payload|metadata/,
  );
  const apiCandidateTypeStart = apiSource.indexOf('export type ConsoleWidgetNextLocalReplyCandidate = {');
  assert.notEqual(apiCandidateTypeStart, -1);
  const apiCandidateTypeEnd = apiSource.indexOf('};', apiCandidateTypeStart);
  assert.notEqual(apiCandidateTypeEnd, -1);
  const apiCandidateTypeSource = apiSource.slice(apiCandidateTypeStart, apiCandidateTypeEnd);

  for (const label of allowedLabels) {
    assert.match(apiCandidateTypeSource, new RegExp(`${label}:`));
  }

  assert.doesNotMatch(
    apiCandidateTypeSource,
    /visitorSessionId|routeHandleSnapshot|visitorMessageBody|clientMessageBody|messageBody|messageText|bodyText|messageContent|rawContent|localIntent|intentPayload|payload|metadata/,
  );
});

test('console shell CSS uses semantic tokens and overflow-safe site/widget layouts', () => {
  assert.match(stylesSource, /--background:/);
  assert.match(stylesSource, /--foreground:/);
  assert.match(stylesSource, /--sidebar:/);
  assert.match(stylesSource, /\.console-shell \{[\s\S]*min-width: 0;[\s\S]*min-height: 100dvh;[\s\S]*grid-template-columns: 280px minmax\(0, 1fr\);/);
  assert.match(stylesSource, /\.console-main \{[\s\S]*min-width: 0;[\s\S]*overflow-x: hidden;/);
  assert.match(stylesSource, /\.content-section \{[\s\S]*min-width: 0;/);
  assert.match(stylesSource, /\.list-card \{[\s\S]*min-width: 0;/);
  assert.match(stylesSource, /\.empty-state \{/);
  assert.match(stylesSource, /\.settings-grid \{/);
  assert.match(stylesSource, /\.snippet-box \{/);
  assert.match(stylesSource, /\.connection-status \{/);
  assert.match(stylesSource, /overflow-wrap: anywhere;/);
  assert.match(stylesSource, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(stylesSource, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|cssText|url\(/);
});
