import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as ts from 'typescript';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const viewSource = await readFile(new URL('../src/widget-chat-view.tsx', import.meta.url), 'utf8');
const composerSource = await readFile(new URL('../src/widget-composer.ts', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const viteEnvSource = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
const publicKeySource = await readFile(new URL('../src/widget-public-key.ts', import.meta.url), 'utf8');
const bootstrapSource = await readFile(new URL('../src/widget-bootstrap.ts', import.meta.url), 'utf8');
const themeSource = await readFile(new URL('../src/widget-theme.ts', import.meta.url), 'utf8');
const chatSource = await readFile(new URL('../src/widget-chat.ts', import.meta.url), 'utf8');
const widgetVisitorIdentitySource = await readFile(new URL('../src/widget-visitor-identity.ts', import.meta.url), 'utf8');
const sharedVisitorIdentity = await import('@panda-chat-widget/shared');
const ownerOnlyLocalDeliveryPattern = /localDelivery|nextLocalReplyCandidate|nextLocalReplyTarget|replyTarget|targetIntentId|queuedIntentCount|lastQueuedAt|claimedIntentCount|lastClaimedAt|appliedLocalReplyCount|lastAppliedLocalReplyAt/i;

function compileTypeScript(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function loadModule(compiledSource, globals = {}) {
  const module = { exports: {} };

  vm.runInNewContext(
    compiledSource,
    {
      exports: module.exports,
      module,
      URL,
      URLSearchParams,
      ...globals,
    },
    { timeout: 1000 },
  );

  return module.exports;
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

const compiledPublicKeyModule = compileTypeScript(publicKeySource);
const compiledBootstrapModule = compileTypeScript(bootstrapSource);
const compiledThemeModule = compileTypeScript(themeSource);
const compiledComposerModule = compileTypeScript(composerSource);
const compiledChatModule = compileTypeScript(chatSource);
const compiledWidgetVisitorIdentityModule = compileTypeScript(widgetVisitorIdentitySource);

function loadWidgetModule(compiledSource) {
  return loadModule(compiledSource, {
    require: (specifier) => {
      if (specifier === '@panda-chat-widget/shared') {
        return sharedVisitorIdentity;
      }

      throw new Error(`unexpected test module import: ${specifier}`);
    },
  });
}

function sampleBootstrap(publicKey = 'demo-local-widget') {
  return {
    widget: { publicKey },
    origin: { hostname: 'localhost', domain: 'localhost' },
    config: {
      assistant: { displayName: 'Support' },
      launcher: { label: 'Chat', icon: 'message' },
      welcome: { title: 'Hi there', subtitle: 'Send us a message and we will reply as soon as we can.' },
      theme: { colorMode: 'system', accent: 'blue', radius: 'md' },
    },
  };
}

function sampleMessage(overrides = {}) {
  return {
    id: overrides.id ?? 'message-1',
    conversationId: overrides.conversationId ?? 'conversation-1',
    seq: overrides.seq ?? 1,
    sender: overrides.sender ?? 'visitor',
    clientMessageId: overrides.clientMessageId ?? null,
    body: overrides.body ?? 'Hello',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
  };
}

function createFakeStorage(initialEntries = {}) {
  const entries = { ...initialEntries };

  return {
    entries,
    getItem: (key) => (Object.hasOwn(entries, key) ? entries[key] : null),
    setItem: (key, value) => {
      entries[key] = value;
    },
  };
}

async function flushAsyncWork() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}


test('widget UI package exposes real Vite scripts and dependencies', () => {
  assert.equal(packageJson.scripts.dev, 'vite --host 127.0.0.1');
  assert.equal(packageJson.scripts.build, 'rm -rf dist && tsc -p tsconfig.json --noEmit --pretty false && vite build');
  assert.equal(packageJson.dependencies['@panda-chat-widget/shared'], 'workspace:*');
  assert.equal(packageJson.scripts.test, 'node --test "test/**/*.test.mjs"');
  assert.equal(packageJson.dependencies.react.startsWith('^'), true);
  assert.equal(packageJson.dependencies['react-dom'].startsWith('^'), true);
  assert.equal(packageJson.devDependencies.vite.startsWith('^'), true);
  assert.equal(packageJson.devDependencies['@types/react'].startsWith('^'), true);
  assert.equal(packageJson.devDependencies['@types/react-dom'].startsWith('^'), true);
});

test('widget UI has a Vite HTML entry and React render root', () => {
  assert.match(indexHtml, /<div id="root"><\/div>/);
  assert.match(indexHtml, /type="module" src="\/src\/main\.tsx"/);
  assert.match(mainSource, /readWidgetPublicKey\(window\.location\.search\)/);
  assert.match(mainSource, /bootstrapBaseHref = window\.location\.href/);
  assert.match(mainSource, /createRoot\(rootElement\)\.render/);
  assert.match(mainSource, /<StrictMode>/);
  assert.match(mainSource, /<App widgetPublicKey=\{widgetPublicKey\} bootstrapBaseHref=\{bootstrapBaseHref\} \/>/);
});

test('widget UI renders bootstrap states through focused chat presentation components', () => {
  assert.match(appSource, /Loading chat/);
  assert.match(appSource, /Chat is not ready/);
  assert.match(appSource, /Chat is unavailable/);
  assert.match(appSource, /data-state=\{bootstrapState\.status\}/);
  assert.match(appSource, /getOrCreateWidgetVisitorKey/);
  assert.match(appSource, /createWidgetVisitorSession/);
  assert.match(appSource, /createWidgetConversation/);
  assert.match(appSource, /listWidgetMessages/);
  assert.match(appSource, /subscribeToWidgetMessages/);
  assert.match(appSource, /sendWidgetMessage/);
  assert.match(appSource, /Starting chat/);
  assert.match(appSource, /<WidgetHeader assistantName=\{assistant\.displayName\} \/>/);
  assert.match(appSource, /<WidgetEmptyConversation title=\{welcomeTitle\} subtitle=\{welcomeSubtitle\} \/>/);
  assert.match(appSource, /<WidgetMessageList assistantName=\{assistantName\} messages=\{chatState\.messageState\.messages\} \/>/);
  assert.match(appSource, /<WidgetComposer/);
  assert.match(viewSource, /function WidgetHeader/);
  assert.match(viewSource, /function WidgetEmptyConversation/);
  assert.match(viewSource, /function WidgetMessageList/);
  assert.match(viewSource, /function WidgetComposer/);
  assert.match(stylesSource, /\.widget-shell/);
  assert.match(viteEnvSource, /vite\/client/);
  assert.doesNotMatch(`${mainSource}
${appSource}
${viewSource}
${composerSource}
${chatSource}`, /XMLHttpRequest|postMessage|Gateway|WebSocket/i);
  assert.doesNotMatch(`${mainSource}
${appSource}
${viewSource}
${composerSource}
${bootstrapSource}
${chatSource}`, ownerOnlyLocalDeliveryPattern);
});


test('widget UI shell stays inside iframe bounds and keeps one panel surface', () => {
  assert.match(stylesSource, /html,\s*\nbody,\s*\n#root \{\s*height: 100%;/);
  assert.match(stylesSource, /body \{[\s\S]*min-width: 0;[\s\S]*min-height: 100%;[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /\.widget-shell \{[\s\S]*width: 100%;[\s\S]*max-width: 100%;[\s\S]*height: 100%;[\s\S]*min-height: 100%;/);
  assert.match(stylesSource, /\.widget-shell \{[\s\S]*display: flex;[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /\.widget-shell \{[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /env\(safe-area-inset-bottom, 0px\)/);
  assert.match(stylesSource, /@media \(max-width: 359px\), \(max-height: 420px\)/);
  assert.match(stylesSource, /overflow-wrap: anywhere;/);
  assert.match(stylesSource, /\.widget-panel \{[\s\S]*width: 100%;[\s\S]*min-height: 0;[\s\S]*display: flex;[\s\S]*flex: 1;[\s\S]*overflow: hidden;/);
  assert.doesNotMatch(stylesSource, /\.widget-welcome|widget-shell__eyebrow/);
  assert.doesNotMatch(`${mainSource}\n${appSource}\n${viewSource}\n${stylesSource}`, /postMessage|ResizeObserver|window\.parent|parent\.postMessage/i);
});

test('mobile chat CSS keeps messages scrollable and the compact composer reachable', () => {
  assert.match(stylesSource, /\.widget-chat \{[\s\S]*min-height: 0;[\s\S]*display: flex;[\s\S]*flex-direction: column;[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /\.widget-chat__messages \{[\s\S]*overflow-y: auto;[\s\S]*overscroll-behavior: contain;[\s\S]*scroll-padding-block: 16px max\(16px, env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(stylesSource, /\.widget-chat__composer \{[\s\S]*position: relative;[\s\S]*z-index: 3;[\s\S]*padding: 4px 12px max\(12px, env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(stylesSource, /\.widget-chat__composer textarea \{[\s\S]*min-height: 42px;[\s\S]*max-height: 144px;[\s\S]*resize: none;/);
  assert.match(stylesSource, /@media \(max-width: 359px\), \(max-height: 420px\) \{[\s\S]*\.widget-chat__messages \{[\s\S]*padding: 14px 12px 10px;[\s\S]*\.widget-chat__composer \{[\s\S]*padding-bottom: max\(8px, env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(stylesSource, /@media \(max-height: 420px\) \{[\s\S]*\.widget-chat__empty-icon \{[\s\S]*display: none;[\s\S]*\.widget-chat__empty p \{[\s\S]*display: none;/);
  assert.doesNotMatch(`${mainSource}\n${appSource}\n${viewSource}\n${stylesSource}`, /postMessage|ResizeObserver|window\.parent|parent\.postMessage/i);
});

test('widget states keep static live text separate from optional actions', () => {
  const stateMessage = viewSource.match(/export function WidgetStateMessage[\s\S]*?\n}\n\nexport function WidgetHeader/)?.[0] ?? '';

  assert.match(stateMessage, /<section className=\{`widget-state widget-state--\$\{tone\}`\}>/);
  assert.match(stateMessage, /<div key=\{role\} className="widget-state__content" role=\{role\} aria-live=/);
  assert.match(stateMessage, /<\/div>\s*\{action\}\s*<\/section>/);
  assert.doesNotMatch(stateMessage.match(/<section[^>]*>/)?.[0] ?? '', /role=|aria-live=/);
  assert.match(appSource, /title="Loading chat…" body="This should only take a moment\."/);
  assert.match(appSource, /title="Starting chat…" body="Connecting you now\."/);
  assert.match(appSource, /title="Chat is unavailable" body="Please try again later\." role="alert"/);
  assert.match(stylesSource, /\.widget-state__content \{[\s\S]*display: grid;[\s\S]*place-items: center;/);
  assert.doesNotMatch(`${appSource}\n${viewSource}\n${stylesSource}`, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|cssText|url\(/);
});

test('widget chat retry source contract keeps one guarded initialization chain', () => {
  // These are tolerant wiring guards, not proof of runtime batching, StrictMode, storage, or accessibility behavior.
  const widgetChat = appSource.match(/function WidgetChat[\s\S]*?\n}\n\nfunction mergeLiveMessage/)?.[0] ?? '';
  const retryHandler = widgetChat.match(/function handleRetry[\s\S]*?\n  }\n\n  function handleSubmit/)?.[0] ?? '';
  const initializeChat = widgetChat.match(/async function initializeChat[\s\S]*?\n    }\n\n    retryPendingRef/)?.[0] ?? '';
  const retryMarkup = widgetChat.match(/<WidgetStateMessage\s+tone="error"[\s\S]*?\/>/)?.[0] ?? '';

  assert.match(
    retryHandler,
    /if \(retryPendingRef\.current\)[\s\S]*retryPendingRef\.current = true;[\s\S]*setChatState\(\{ status: 'loading' \}\);[\s\S]*setInitializationAttempt\(\([^)]*\) => [^)]* \+ 1\)/,
  );
  assert.match(widgetChat, /useEffect\([\s\S]*?\}, \[[^\]]*publicKey[^\]]*initializationAttempt[^\]]*\]\);/);
  assert.match(
    initializeChat,
    /visitorKey\?\.publicKey !== publicKey[\s\S]*getOrCreateWidgetVisitorKey\(publicKey\)[\s\S]*visitorKeyRef\.current = visitorKey/,
  );
  assert.match(
    initializeChat,
    /await createWidgetVisitorSession[\s\S]*if \(!isCurrent\)[\s\S]*await createWidgetConversation[\s\S]*if \(!isCurrent\)[\s\S]*await listWidgetMessages[\s\S]*if \(!isCurrent\)[\s\S]*setChatState\([\s\S]*subscribeToWidgetMessages/,
  );
  assert.match(widgetChat, /return \(\) => \{\s*isCurrent = false;\s*subscription\?\.close\(\);/);

  assert.match(retryMarkup, /title="Chat couldn’t start"/);
  assert.match(retryMarkup, /body="Try again now, or come back later\."/);
  assert.match(retryMarkup, /role="alert"/);
  assert.match(retryMarkup, /<button className="widget-state__action" type="button" onClick=\{handleRetry\}>\s*Try again\s*<\/button>/);
  assert.doesNotMatch(retryMarkup, /publicKey|visitorSession|conversation|https?:|statusCode|response|owner|Panda|Gateway/i);

  assert.match(stylesSource, /\.widget-state__action \{[\s\S]*min-height: 36px;[\s\S]*background: var\(--widget-primary\);/);
  assert.match(stylesSource, /\.widget-state__action:focus-visible,[\s\S]*outline: 3px solid var\(--widget-ring\);/);

  assert.doesNotMatch(widgetChat, /AbortController|setTimeout|setInterval|localStorage|sessionStorage|\bfetch\(|XMLHttpRequest|sendBeacon|console\./);
  assert.doesNotMatch(
    `${bootstrapSource}\n${chatSource}\n${widgetVisitorIdentitySource}`,
    /initializationAttempt|retryPendingRef|widget-state__action|Try again now, or come back later\./,
  );
});

test('chat presentation follows the SalesPanda message and composer hierarchy', () => {
  assert.match(appSource, /className="widget-chat__messages"[\s\S]*aria-live="polite"[\s\S]*ref=\{messageScrollRef\}/);
  assert.match(viewSource, /className="widget-chat__message-list"/);
  assert.match(viewSource, /data-sender=\{message\.sender\}/);
  assert.match(viewSource, /className="sr-only">\{message\.sender === 'visitor' \? 'You' : assistantName\}/);
  assert.match(stylesSource, /\.widget-chat__messages \{[\s\S]*min-height: 0;[\s\S]*overflow-x: hidden;[\s\S]*overflow-y: auto;/);
  assert.match(stylesSource, /\.widget-chat__message-list \{[\s\S]*display: flex;[\s\S]*flex-direction: column;[\s\S]*list-style: none;/);
  assert.match(stylesSource, /\.widget-chat__message\[data-sender="visitor"\] \{[\s\S]*max-width: 85%;[\s\S]*align-self: flex-end;[\s\S]*border-radius: var\(--widget-message-radius\);[\s\S]*background: var\(--widget-bubble\);/);
  const assistantRule = stylesSource.match(/\.widget-chat__message\[data-sender="agent"\],[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(assistantRule, /align-self: stretch;/);
  assert.doesNotMatch(assistantRule, /background|border-radius|padding/);
  assert.match(stylesSource, /\.widget-chat__message p \{[\s\S]*overflow-wrap: anywhere;[\s\S]*white-space: pre-wrap;/);
  assert.match(viewSource, /className="widget-chat__composer-control"/);
  assert.match(viewSource, /className="widget-chat__composer-footer"/);
  assert.match(viewSource, /placeholder="Ask, search, or chat…"/);
  assert.doesNotMatch(`${appSource}\n${viewSource}\n${stylesSource}`, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|cssText|url\(/);
});


test('widget chat source contract preserves reader position and offers one jump-to-latest overlay', () => {
  // Source checks wiring and guardrails; browser coverage proves scroll and RAF timing.
  const effectMatch = appSource.match(/useLayoutEffect\(\(\) => \{([\s\S]*?)\n  \}, \[readyConversationId, latestRenderedSeq\]\);/);
  const scrollHandlerMatch = appSource.match(/function handleMessageScroll\(\) \{([\s\S]*?)\n  \}\n\n  function handleJumpToLatest/);
  const jumpHandlerMatch = appSource.match(/function handleJumpToLatest\(\) \{([\s\S]*?)\n  \}\n\n  function handleRetry/);
  const jumpButtonMatch = appSource.match(/<button className="widget-chat__jump-to-latest" type="button" onClick=\{handleJumpToLatest\}>\s*Jump to latest\s*<\/button>/);

  assert.ok(effectMatch);
  assert.ok(scrollHandlerMatch);
  assert.ok(jumpHandlerMatch);
  assert.ok(jumpButtonMatch);
  assert.equal(appSource.match(/Jump to latest/g)?.length, 1);
  assert.match(appSource, /className="widget-chat__messages"[\s\S]*aria-live="polite"[\s\S]*ref=\{messageScrollRef\}[\s\S]*onScroll=\{handleMessageScroll\}/);

  const [, scrollHandlerBody] = scrollHandlerMatch;
  assert.match(
    scrollHandlerBody,
    /Math\.max\(\s*0,\s*messageScrollElement\.scrollHeight\s*-\s*messageScrollElement\.clientHeight\s*-\s*messageScrollElement\.scrollTop,?\s*\)\s*<=\s*48/,
  );
  assert.match(scrollHandlerBody, /followsLatestRef\.current = followsLatest;/);
  assert.match(scrollHandlerBody, /if \(followsLatest\) \{\s*setShowJumpToLatest\(false\);\s*\}/);
  assert.doesNotMatch(scrollHandlerBody, /Math\.(?:ceil|floor|round|trunc)|setShowJumpToLatest\(true\)/);

  const [, effectBody] = effectMatch;
  assert.match(effectBody, /if \(!readyConversationId\) \{\s*previousReadyConversationRef\.current = null;\s*return;/);
  assert.match(effectBody, /previousReadyConversation\?\.conversationId !== readyConversationId/);
  assert.match(effectBody, /latestRenderedSeq > previousReadyConversation\.latestSeq/);
  assert.match(effectBody, /if \(!isNewConversation && !hasHigherLatestSeq\) \{\s*return;/);
  assert.match(effectBody, /if \(isNewConversation\) \{\s*followsLatestRef\.current = true;\s*setShowJumpToLatest\(false\);/);
  assert.match(effectBody, /if \(renderedMessageCount === 0\) \{\s*return;/);

  const unpinnedBranch = effectBody.match(/if \(!followsLatestRef\.current\) \{([\s\S]*?)\n    \}/)?.[1] ?? '';
  assert.match(unpinnedBranch, /setShowJumpToLatest\(true\);\s*return;/);
  assert.doesNotMatch(unpinnedBranch, /scrollTop|requestAnimationFrame/);
  assert.match(effectBody, /messageScrollElement\.scrollTop = messageScrollElement\.scrollHeight;[\s\S]*requestAnimationFrame\(\(\) =>/);
  assert.equal(effectBody.match(/\brequestAnimationFrame\(/g)?.length, 1);
  assert.match(effectBody, /messageCorrectionAnimationFrameRef\.current !== animationFrameId/);
  assert.match(effectBody, /!followsLatestRef\.current \|\| messageScrollRef\.current !== messageScrollElement/);
  assert.match(effectBody, /cancelAnimationFrame\(animationFrameId\);[\s\S]*messageCorrectionAnimationFrameRef\.current = null;/);
  assert.equal(effectBody.match(/\bcancelAnimationFrame\(/g)?.length, 1);

  const [, jumpHandlerBody] = jumpHandlerMatch;
  assert.match(jumpHandlerBody, /followsLatestRef\.current = true;\s*setShowJumpToLatest\(false\);/);
  assert.match(jumpHandlerBody, /messageScrollElement\.scrollTop = messageScrollElement\.scrollHeight;/);
  assert.doesNotMatch(jumpHandlerBody, /requestAnimationFrame|scrollTo\(|behavior|focus\(/);
  assert.doesNotMatch(jumpButtonMatch[0], /autoFocus|aria-label|data-(?:message|count|seq|body)/i);

  assert.match(appSource, /<div className="widget-chat__message-region">[\s\S]*className="widget-chat__messages"[\s\S]*\{showJumpToLatest \? \([\s\S]*widget-chat__jump-to-latest[\s\S]*<\/div>\s*<WidgetComposer/);
  assert.match(stylesSource, /\.widget-chat__message-region \{[\s\S]*position: relative;[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /\.widget-chat__jump-to-latest \{[\s\S]*position: absolute;[\s\S]*min-height: 32px;[\s\S]*color: [^;]+;[\s\S]*background: [^;]+;/);
  assert.match(stylesSource, /\.widget-state__action:focus-visible,[\s\S]*\.widget-chat__jump-to-latest:focus-visible,[\s\S]*outline: 3px solid var\(--widget-ring\);/);
  assert.match(stylesSource, /\.widget-panel\[data-color-mode="dark"\],[\s\S]*--widget-background: #111827;/);
  assert.match(stylesSource, /@media \(prefers-color-scheme: dark\) \{[\s\S]*\.widget-panel\[data-color-mode="system"\]/);
  assert.doesNotMatch(`${appSource}\n${stylesSource}`, /ResizeObserver|\bscroll-behavior|behavior:\s*['"]smooth['"]|autoFocus|postMessage|window\.parent|parent\.postMessage/i);
});

test('composer interaction exposes multiline textarea submit affordance and accessible states', () => {
  const composerButtonRule = stylesSource.match(/^\.widget-chat__composer button \{([^}]*)\}$/m)?.[1] ?? '';

  assert.match(composerButtonRule, /min-height: 44px;/);
  assert.match(appSource, /const isSending = chatState\.sendStatus === 'sending';/);
  assert.match(appSource, /const canSend = !isSending && draftMessage\.trim\(\)\.length > 0;/);
  assert.match(appSource, /function submitDraftMessage\(\) \{[\s\S]*sendInFlightRef\.current \|\| chatState\.status !== 'ready'[\s\S]*const draftSource = draftMessageRef\.current;[\s\S]*const normalizedBody = draftSource\.trim\(\);[\s\S]*if \(!normalizedBody\)/);
  assert.match(viewSource, /Press Enter to send\. Shift\+Enter for a new line\./);
  assert.match(viewSource, /Sending…/);
  assert.match(viewSource, /Couldn’t send\. Try again\./);
  assert.match(viewSource, /<form className="widget-chat__composer" onSubmit=\{onSubmit\} data-send-status=\{sendStatus\} aria-busy=\{isSending\}>/);
  assert.match(viewSource, /htmlFor="widget-chat-message-input"/);
  assert.match(viewSource, /<textarea[\s\S]*id="widget-chat-message-input"[\s\S]*rows=\{1\}/);
  assert.match(appSource, /onKeyDown=\{handleComposerKeyDown\}/);
  assert.match(appSource, /resolveWidgetComposerKeyAction\(event, draftMessage\)/);
  assert.match(viewSource, /placeholder="Ask, search, or chat…"/);
  assert.match(viewSource, /autoComplete="off"/);
  assert.match(viewSource, /aria-describedby="widget-chat-composer-hint widget-chat-composer-status"/);
  assert.match(viewSource, /disabled=\{isSending\}/);
  assert.match(viewSource, /<button type="submit" disabled=\{!canSend\}/);
  assert.match(viewSource, /aria-label=\{isSending \? 'Sending message' : 'Send message'\}/);
  assert.match(viewSource, /role=\{sendStatus === 'error' \? 'alert' : 'status'\}/);
  assert.match(stylesSource, /\.widget-chat__composer-control \{[\s\S]*border-radius: var\(--widget-control-radius\);/);
  assert.match(stylesSource, /\.widget-chat__composer textarea \{[\s\S]*min-height: 42px;[\s\S]*max-height: 144px;[\s\S]*resize: none;/);
  assert.match(stylesSource, /\.widget-chat__composer textarea::placeholder \{[\s\S]*color: var\(--widget-muted-foreground\);/);
  assert.match(stylesSource, /\.widget-chat__composer button:disabled \{[\s\S]*opacity: 0\.28;/);
  assert.match(stylesSource, /\.widget-chat__composer\[data-send-status="error"\] \.widget-chat__composer-control \{[\s\S]*border-color: var\(--widget-destructive\);/);
  assert.match(stylesSource, /\.widget-chat__composer\[data-send-status="error"\] \.widget-chat__composer-status \{[\s\S]*color: var\(--widget-destructive\);[\s\S]*font-weight: 600;/);
  assert.doesNotMatch(viewSource, /<input|type="text"|onKeyUp/);
  assert.doesNotMatch(`${appSource}
${viewSource}
${composerSource}
${stylesSource}`, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|style=|cssText|url\(/);
});

test('composer failed-send retry keeps one scoped in-page attempt', () => {
  // Source proves wiring/order/privacy only; browser and real Postgres probes must prove races and idempotency.
  const widgetChat = appSource.match(/function WidgetChat[\s\S]*?\n}\n\nfunction mergeLiveMessage/)?.[0] ?? '';
  const submit = widgetChat.match(/async function submitDraftMessage[\s\S]*?\n  }\n\n  function handleMessageScroll/)?.[0] ?? '';
  const pendingDeclaration = widgetChat.match(/const pendingSendAttemptRef = useRef<\{[\s\S]*?\} \| null>\(null\);/)?.[0] ?? '';
  const composerChange = widgetChat.match(/onChange=\{\(event\) => \{[\s\S]*?\}\}/)?.[0] ?? '';
  const readyMarkup = widgetChat.match(/return \(\s*<div className="widget-chat"[\s\S]*?\n  \);\n}/)?.[0] ?? '';

  assert.match(pendingDeclaration, /publicKey: string;[\s\S]*visitorSessionId: string;[\s\S]*conversationId: string;[\s\S]*normalizedBody: string;[\s\S]*clientMessageId: string;/);
  assert.equal(pendingDeclaration.match(/: string;/g)?.length, 5);
  assert.match(submit, /pendingAttempt\?\.publicKey === publicKey[\s\S]*pendingAttempt\.visitorSessionId === chatState\.visitorSessionId[\s\S]*pendingAttempt\.conversationId === chatState\.conversationId[\s\S]*pendingAttempt\.normalizedBody === normalizedBody[\s\S]*\? pendingAttempt/);

  const orderedSendSteps = [
    'if (sendInFlightRef.current',
    'sendInFlightRef.current = true;',
    'try {',
    'createWidgetClientMessageId()',
    'pendingSendAttemptRef.current = attempt;',
    "draftMessageRef.current = '';",
    "setDraftMessage('');",
    'await sendWidgetMessage(',
    '} catch {',
    '} finally {',
    'sendInFlightRef.current = false;',
  ].map((step) => submit.indexOf(step));
  assert.ok(orderedSendSteps.every((position) => position >= 0));
  assert.deepEqual(orderedSendSteps, [...orderedSendSteps].sort((left, right) => left - right));

  assert.equal(submit.match(/pendingSendAttemptRef\.current === attempt/g)?.length, 2);
  assert.match(submit, /if \(pendingSendAttemptRef\.current === attempt\) \{\s*pendingSendAttemptRef\.current = null;/);
  assert.match(submit, /catch \{[\s\S]*if \(attempt === null && draftMessageRef\.current === draftSource\) \{\s*draftMessageRef\.current = normalizedBody;\s*setDraftMessage\(normalizedBody\);[\s\S]*else if \(attempt !== null && pendingSendAttemptRef\.current === attempt\) \{\s*draftMessageRef\.current = attempt\.normalizedBody;\s*setDraftMessage\(attempt\.normalizedBody\);/);
  assert.match(submit, /finally \{\s*sendInFlightRef\.current = false;\s*\}/);

  const orderedEditSteps = [
    'pendingSendAttemptRef.current = null;',
    'draftMessageRef.current = event.target.value;',
    'setDraftMessage(event.target.value);',
  ].map((step) => composerChange.indexOf(step));
  assert.ok(orderedEditSteps.every((position) => position >= 0));
  assert.deepEqual(orderedEditSteps, [...orderedEditSteps].sort((left, right) => left - right));
  assert.doesNotMatch(widgetChat, /localStorage|sessionStorage|indexedDB|document\.cookie|console\./);
  assert.ok(readyMarkup);
  assert.doesNotMatch(readyMarkup, /clientMessageId/);
});

test('composer keyboard behavior submits plain Enter without breaking multiline input or IME composition', () => {
  const { resolveWidgetComposerKeyAction } = loadModule(compiledComposerModule);

  assert.deepEqual(jsonSafe(resolveWidgetComposerKeyAction({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false } }, '  Hello\n')), {
    shouldPreventDefault: true,
    shouldSubmit: true,
  });
  assert.deepEqual(jsonSafe(resolveWidgetComposerKeyAction({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false } }, '  \n  ')), {
    shouldPreventDefault: true,
    shouldSubmit: false,
  });
  assert.deepEqual(jsonSafe(resolveWidgetComposerKeyAction({ key: 'Enter', shiftKey: true, nativeEvent: { isComposing: false } }, 'Hello')), {
    shouldPreventDefault: false,
    shouldSubmit: false,
  });
  assert.deepEqual(jsonSafe(resolveWidgetComposerKeyAction({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true } }, 'Hello')), {
    shouldPreventDefault: false,
    shouldSubmit: false,
  });
  assert.deepEqual(jsonSafe(resolveWidgetComposerKeyAction({ key: 'a', shiftKey: false, nativeEvent: { isComposing: false } }, 'Hello')), {
    shouldPreventDefault: false,
    shouldSubmit: false,
  });
});

test('keyboard send focus intent is armed after capture and cancelled by other submit paths', () => {
  // Source checks event ordering and data boundaries only; real Chromium must prove focus behavior.
  const widgetChat = appSource.match(/function WidgetChat[\s\S]*?\n}\n\nfunction mergeLiveMessage/)?.[0] ?? '';
  const listenerEffect = widgetChat.match(/useEffect\(\(\) => \{\n    function markInteraction[\s\S]*?\n  }, \[\]\);/)?.[0] ?? '';
  const submitHandler = widgetChat.match(/function handleSubmit[\s\S]*?\n  }\n\n  function handleComposerKeyDown/)?.[0] ?? '';
  const keyHandler = widgetChat.match(/function handleComposerKeyDown[\s\S]*?\n  }\n\n  if \(chatState\.status/)?.[0] ?? '';
  const pendingRequest = widgetChat.match(/const pendingComposerFocusRef = useRef<\{[\s\S]*?\} \| null>\(null\);/)?.[0] ?? '';

  assert.match(widgetChat, /const \[composerFocusSettleTick, setComposerFocusSettleTick\] = useState\(0\);/);
  assert.match(widgetChat, /const interactionEpochRef = useRef\(0\);/);
  assert.match(widgetChat, /const latestComposerScopeRef = useRef<\{\s*publicKey: string;\s*visitorSessionId: string;\s*conversationId: string;\s*\} \| null>\(null\);/);
  assert.match(widgetChat, /const composerTextareaRef = useRef<HTMLTextAreaElement \| null>\(null\);/);
  assert.deepEqual([...pendingRequest.matchAll(/^    (\w+):/gm)].map((match) => match[1]), [
    'textarea',
    'interactionEpoch',
    'publicKey',
    'visitorSessionId',
    'conversationId',
  ]);
  assert.doesNotMatch(pendingRequest, /body|content|draft|clientMessageId|event/i);
  assert.match(widgetChat, /latestComposerScopeRef\.current = chatState\.status === 'ready'\s*\? \{ publicKey, visitorSessionId: chatState\.visitorSessionId, conversationId: chatState\.conversationId \}\s*: null;/);

  const listeners = [
    ['pointerdown', 'markInteraction', true],
    ['keydown', 'markInteraction', true],
    ['focusin', 'handleFocusIn', true],
    ['blur', 'handleWindowBlur', false],
  ];
  assert.equal(listenerEffect.match(/window\.addEventListener\(/g)?.length, listeners.length);
  assert.equal(listenerEffect.match(/window\.removeEventListener\(/g)?.length, listeners.length);
  for (const [eventName, handler, capture] of listeners) {
    const options = capture ? ', true' : '';
    assert.equal(listenerEffect.split(`window.addEventListener('${eventName}', ${handler}${options});`).length - 1, 1);
    assert.equal(listenerEffect.split(`window.removeEventListener('${eventName}', ${handler}${options});`).length - 1, 1);
  }
  assert.match(listenerEffect, /event\.target !== document\.body && event\.target !== document\.documentElement/);
  assert.match(listenerEffect, /if \(event\.target === window\) \{\s*markInteraction\(\);/);
  assert.match(listenerEffect, /pendingComposerFocusRef\.current = null;\s*};\s*}, \[\]\);/);

  const submitSteps = ['event.preventDefault();', 'pendingComposerFocusRef.current = null;', 'void submitDraftMessage();']
    .map((step) => submitHandler.indexOf(step));
  assert.ok(submitSteps.every((position) => position >= 0));
  assert.deepEqual(submitSteps, [...submitSteps].sort((left, right) => left - right));

  for (const gate of [
    '!keyAction.shouldSubmit',
    'sendInFlightRef.current',
    'event.currentTarget !== document.activeElement',
    '!document.hasFocus()',
    '!latestScope',
  ]) {
    assert.ok(keyHandler.includes(gate), `missing keyboard focus gate: ${gate}`);
  }
  const armSteps = [
    'event.preventDefault();',
    'interactionEpoch: interactionEpochRef.current,',
    'pendingComposerFocusRef.current = request;',
    'submitDraftMessage().finally(() => {',
    'pendingComposerFocusRef.current === request',
    'setComposerFocusSettleTick((currentTick) => currentTick + 1);',
  ].map((step) => keyHandler.indexOf(step));
  assert.ok(armSteps.every((position) => position >= 0));
  assert.deepEqual(armSteps, [...armSteps].sort((left, right) => left - right));
  assert.match(widgetChat, /textareaRef=\{composerTextareaRef\}/);
  assert.match(viewSource, /<textarea\s+ref=\{textareaRef\}/);
});

test('keyboard send focus intent is consumed before guarded neutral-focus restoration', () => {
  // This source wiring cannot prove browser focus, iframe blur, StrictMode, or scroll behavior.
  const widgetChat = appSource.match(/function WidgetChat[\s\S]*?\n}\n\nfunction mergeLiveMessage/)?.[0] ?? '';
  const focusEffect = widgetChat.match(/useLayoutEffect\(\(\) => \{\n    const request = pendingComposerFocusRef[\s\S]*?\n  }, \[composerFocusSettleTick\]\);/)?.[0] ?? '';
  const consumePosition = focusEffect.indexOf('pendingComposerFocusRef.current = null;');
  const guardPosition = focusEffect.indexOf('interactionEpochRef.current !== request.interactionEpoch');

  assert.ok(consumePosition >= 0 && consumePosition < guardPosition);
  for (const guard of [
    'latestScope?.publicKey !== request.publicKey',
    'latestScope.visitorSessionId !== request.visitorSessionId',
    'latestScope.conversationId !== request.conversationId',
    'composerTextareaRef.current !== request.textarea',
    '!request.textarea.isConnected',
    'request.textarea.disabled',
    '!document.hasFocus()',
    'activeElement !== document.body && activeElement !== document.documentElement && activeElement !== null',
  ]) {
    assert.ok(focusEffect.includes(guard), `missing settle guard: ${guard}`);
  }
  assert.match(focusEffect, /request\.textarea\.focus\(\{ preventScroll: true \}\);/);
  assert.equal(focusEffect.match(/\.focus\(/g)?.length, 1);
  assert.doesNotMatch(focusEffect, /requestAnimationFrame|setTimeout|try\s*\{|catch|autoFocus|scroll(?:Top|To|IntoView)/);
});

test('chat surface uses safe branding tokens from data attributes', () => {
  assert.match(appSource, /data-color-mode=\{theme\.colorMode\}/);
  assert.match(appSource, /data-accent=\{theme\.accent\}/);
  assert.match(appSource, /data-radius=\{theme\.radius\}/);
  assert.match(stylesSource, /\.widget-panel\[data-accent="blue"\] \{[\s\S]*--widget-bubble: #0ea5e9;/);
  assert.match(stylesSource, /\.widget-panel\[data-radius="md"\] \{[\s\S]*--widget-panel-radius: 24px;[\s\S]*--widget-control-radius: 16px;[\s\S]*--widget-message-radius: 24px;/);
  assert.match(stylesSource, /\.widget-chat__message\[data-sender="visitor"\] \{[\s\S]*border-radius: var\(--widget-message-radius\);[\s\S]*background: var\(--widget-bubble\);/);
  assert.match(stylesSource, /\.widget-chat__composer-control \{[\s\S]*border-radius: var\(--widget-control-radius\);/);
  assert.match(stylesSource, /\.widget-chat__composer button \{[\s\S]*border-radius: 999px;[\s\S]*background: var\(--widget-primary\);/);
  assert.match(stylesSource, /\.widget-panel\[data-color-mode="dark"\],[\s\S]*--widget-bubble: #0369a1;/);
  assert.match(stylesSource, /@media \(prefers-color-scheme: dark\) \{[\s\S]*\.widget-panel\[data-color-mode="system"\]/);
  assert.doesNotMatch(`${appSource}
${viewSource}
${stylesSource}`, /style=|cssText|dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|url\(/);
});

test('loaded bootstrap renders config-driven welcome text and chat safely', () => {
  assert.match(appSource, /<WelcomeState bootstrap=\{state\.bootstrap\} bootstrapBaseHref=\{bootstrapBaseHref\} \/>/);
  assert.match(appSource, /assistant\.displayName/);
  assert.match(appSource, /welcome\.title/);
  assert.match(appSource, /welcome\.subtitle/);
  assert.match(appSource, /resolveWidgetTheme\(themeConfig\)/);
  assert.match(appSource, /theme\.className/);
  assert.match(appSource, /data-color-mode=\{theme\.colorMode\}/);
  assert.match(appSource, /data-accent=\{theme\.accent\}/);
  assert.match(appSource, /data-radius=\{theme\.radius\}/);
  assert.match(appSource, /<WidgetHeader assistantName=\{assistant\.displayName\} \/>/);
  assert.match(appSource, /welcomeTitle=\{welcome\.title\}/);
  assert.match(appSource, /welcomeSubtitle=\{welcome\.subtitle\}/);
  assert.match(appSource, /<WidgetChat[\s\S]*publicKey=\{bootstrap\.widget\.publicKey\}/);
  assert.match(appSource, /assistantName=\{assistant\.displayName\}/);
  assert.match(appSource, /aria-label=\{`\$\{assistantName\} conversation`\}/);
  assert.match(viewSource, /message\.sender === 'visitor' \? 'You' : assistantName/);
  assert.match(stylesSource, /\.widget-panel/);
  assert.match(stylesSource, /\.widget-panel--mode-light/);
  assert.match(stylesSource, /\.widget-panel--mode-dark/);
  assert.match(stylesSource, /\.widget-panel--mode-system/);
  assert.doesNotMatch(`${appSource}
${viewSource}
${stylesSource}`, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|style=|cssText|url\(/);
});


test('theme config path has no arbitrary CSS or HTML injection surface', () => {
  const themeProductSources = [
    mainSource,
    appSource,
    viewSource,
    composerSource,
    bootstrapSource,
    themeSource,
    chatSource,
    widgetVisitorIdentitySource,
    stylesSource,
  ].join('\n');

  assert.match(themeSource, /const COLOR_MODE_CLASS_NAMES = \{[\s\S]*light: 'widget-panel--mode-light',[\s\S]*dark: 'widget-panel--mode-dark',[\s\S]*system: 'widget-panel--mode-system',[\s\S]*\} as const satisfies Record<WidgetBootstrapConfig\['theme'\]\['colorMode'\], string>/);
  assert.match(themeSource, /const ACCENT_CLASS_NAMES = \{[\s\S]*blue: 'widget-panel--accent-blue',[\s\S]*\} as const satisfies Record<WidgetBootstrapConfig\['theme'\]\['accent'\], string>/);
  assert.match(themeSource, /const RADIUS_CLASS_NAMES = \{[\s\S]*md: 'widget-panel--radius-md',[\s\S]*\} as const satisfies Record<WidgetBootstrapConfig\['theme'\]\['radius'\], string>/);
  assert.match(themeSource, /Object\.hasOwn\(tokenMap, value\)/);
  assert.match(themeSource, /className: \[COLOR_MODE_CLASS_NAMES\[colorMode\], ACCENT_CLASS_NAMES\[accent\], RADIUS_CLASS_NAMES\[radius\]\]\.join\(' '\)/);
  assert.doesNotMatch(themeProductSources, /dangerouslySetInnerHTML|\.innerHTML\b|insertAdjacentHTML|cssText|style=|setAttribute\(['"]style|url\(/);
});

test('widget theme resolver maps configured tokens to safe classes', () => {
  const { resolveWidgetTheme } = loadModule(compiledThemeModule);

  assert.deepEqual(jsonSafe(resolveWidgetTheme({ colorMode: 'dark', accent: 'blue', radius: 'md' })), {
    colorMode: 'dark',
    accent: 'blue',
    radius: 'md',
    className: 'widget-panel--mode-dark widget-panel--accent-blue widget-panel--radius-md',
  });
});

test('widget theme resolver falls back safely for unknown runtime tokens', () => {
  const { resolveWidgetTheme } = loadModule(compiledThemeModule);

  const resolvedTheme = resolveWidgetTheme({
    colorMode: 'dark; background: red',
    accent: 'url(javascript:alert(1))',
    radius: '999px',
  });

  assert.deepEqual(jsonSafe(resolvedTheme), {
    colorMode: 'system',
    accent: 'blue',
    radius: 'md',
    className: 'widget-panel--mode-system widget-panel--accent-blue widget-panel--radius-md',
  });
  assert.doesNotMatch(resolvedTheme.className, /background|javascript|999px|url/);
  assert.deepEqual(jsonSafe(resolveWidgetTheme()), {
    colorMode: 'system',
    accent: 'blue',
    radius: 'md',
    className: 'widget-panel--mode-system widget-panel--accent-blue widget-panel--radius-md',
  });
});

test('widget chat client uses existing session, conversation, message, and SSE endpoints', async () => {
  const {
    buildWidgetMessageEventsUrl,
    createWidgetVisitorSession,
    createWidgetConversation,
    listWidgetMessages,
    sendWidgetMessage,
  } = loadModule(compiledChatModule);
  const calls = [];
  const responses = [
    { visitorSession: { id: 'visitor-session-1', visitorKey: 'pvk_test' } },
    { conversation: { id: 'conversation-1', visitorSessionId: 'visitor-session-1', status: 'open' } },
    { messages: [sampleMessage({ id: 'message-1', seq: 1 })] },
    { message: sampleMessage({ id: 'message-2', seq: 2, clientMessageId: 'client-message-1' }) },
  ];
  const fetchImpl = async (input, init) => {
    calls.push({ input: String(input), init });

    return {
      ok: true,
      status: 200,
      json: async () => responses.shift(),
    };
  };
  const baseHref = 'https://customer.example/widget.html?publicKey=demo-local-widget';

  assert.equal(
    buildWidgetMessageEventsUrl('demo-local-widget', {
      visitorSessionId: 'visitor-session-1',
      conversationId: 'conversation-1',
      afterSeq: 2,
    }, baseHref),
    'https://customer.example/api/widgets/demo-local-widget/messages/events?visitorSessionId=visitor-session-1&conversationId=conversation-1&afterSeq=2',
  );

  await createWidgetVisitorSession('demo-local-widget', 'pvk_test', { baseHref, fetchImpl });
  await createWidgetConversation('demo-local-widget', 'visitor-session-1', { baseHref, fetchImpl });
  await listWidgetMessages('demo-local-widget', {
    visitorSessionId: 'visitor-session-1',
    conversationId: 'conversation-1',
  }, { baseHref, fetchImpl });
  await sendWidgetMessage('demo-local-widget', {
    visitorSessionId: 'visitor-session-1',
    conversationId: 'conversation-1',
    clientMessageId: 'client-message-1',
    body: 'Hello',
  }, { baseHref, fetchImpl });

  assert.deepEqual(calls.map((call) => ({ input: call.input, method: call.init.method })), [
    { input: 'https://customer.example/api/widgets/demo-local-widget/visitor-session', method: 'POST' },
    { input: 'https://customer.example/api/widgets/demo-local-widget/conversations', method: 'POST' },
    {
      input: 'https://customer.example/api/widgets/demo-local-widget/messages?visitorSessionId=visitor-session-1&conversationId=conversation-1',
      method: 'GET',
    },
    {
      input: 'https://customer.example/api/widgets/demo-local-widget/messages?visitorSessionId=visitor-session-1&conversationId=conversation-1',
      method: 'POST',
    },
  ]);
  assert.deepEqual(JSON.parse(calls[0].init.body), { visitorKey: 'pvk_test' });
  assert.deepEqual(JSON.parse(calls[1].init.body), { visitorSessionId: 'visitor-session-1' });
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    visitorSessionId: 'visitor-session-1',
    conversationId: 'conversation-1',
    clientMessageId: 'client-message-1',
    body: 'Hello',
  });
  assert.equal(calls[2].init.credentials, 'same-origin');
});

test('widget refresh flow reuses visitor identity, conversation, and message history', async () => {
  const { createWidgetVisitorSession, createWidgetConversation, listWidgetMessages } = loadModule(compiledChatModule);
  const { getOrCreateWidgetVisitorKey } = loadWidgetModule(compiledWidgetVisitorIdentityModule);
  const storage = createFakeStorage();
  const storageKey = sharedVisitorIdentity.buildVisitorKeyStorageKey('demo-local-widget');
  const calls = [];
  let randomCalls = 0;
  const cryptoImpl = {
    getRandomValues: (bytes) => {
      randomCalls += 1;

      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = index + 1;
      }

      return bytes;
    },
  };
  const fetchImpl = async (input, init) => {
    const url = String(input);
    const requestBody = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ input: url, method: init?.method, body: requestBody });

    if (url.endsWith('/visitor-session')) {
      return { ok: true, status: 200, json: async () => ({ visitorSession: { id: 'visitor-session-1', visitorKey: requestBody.visitorKey } }) };
    }

    if (url.endsWith('/conversations')) {
      return { ok: true, status: 200, json: async () => ({ conversation: { id: 'conversation-1', visitorSessionId: requestBody.visitorSessionId, status: 'open' } }) };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        messages: [
          sampleMessage({ id: 'message-1', conversationId: 'conversation-1', seq: 1, body: 'Before refresh' }),
          sampleMessage({ id: 'message-2', conversationId: 'conversation-1', seq: 2, sender: 'agent', body: 'Still here' }),
        ],
      }),
    };
  };
  const baseHref = 'https://customer.example/widget.html?publicKey=demo-local-widget';

  async function loadChatOnce() {
    const visitorKey = getOrCreateWidgetVisitorKey('demo-local-widget', { storage, cryptoImpl });
    const visitorSessionResponse = await createWidgetVisitorSession('demo-local-widget', visitorKey, { baseHref, fetchImpl });
    const conversationResponse = await createWidgetConversation(
      'demo-local-widget',
      visitorSessionResponse.visitorSession.id,
      { baseHref, fetchImpl },
    );
    const messageListResponse = await listWidgetMessages('demo-local-widget', {
      visitorSessionId: visitorSessionResponse.visitorSession.id,
      conversationId: conversationResponse.conversation.id,
    }, { baseHref, fetchImpl });

    return { visitorKey, visitorSessionResponse, conversationResponse, messageListResponse };
  }

  const firstLoad = await loadChatOnce();
  const secondLoad = await loadChatOnce();

  assert.equal(secondLoad.visitorKey, firstLoad.visitorKey);
  assert.equal(storage.entries[storageKey], firstLoad.visitorKey);
  assert.equal(randomCalls, 1);
  assert.equal(secondLoad.visitorSessionResponse.visitorSession.id, 'visitor-session-1');
  assert.equal(secondLoad.conversationResponse.conversation.id, 'conversation-1');
  assert.deepEqual(secondLoad.messageListResponse.messages.map((message) => ({ id: message.id, seq: message.seq, body: message.body })), [
    { id: 'message-1', seq: 1, body: 'Before refresh' },
    { id: 'message-2', seq: 2, body: 'Still here' },
  ]);
  assert.deepEqual(calls.map((call) => ({ input: call.input, method: call.method, body: call.body })), [
    { input: 'https://customer.example/api/widgets/demo-local-widget/visitor-session', method: 'POST', body: { visitorKey: firstLoad.visitorKey } },
    { input: 'https://customer.example/api/widgets/demo-local-widget/conversations', method: 'POST', body: { visitorSessionId: 'visitor-session-1' } },
    { input: 'https://customer.example/api/widgets/demo-local-widget/messages?visitorSessionId=visitor-session-1&conversationId=conversation-1', method: 'GET', body: null },
    { input: 'https://customer.example/api/widgets/demo-local-widget/visitor-session', method: 'POST', body: { visitorKey: firstLoad.visitorKey } },
    { input: 'https://customer.example/api/widgets/demo-local-widget/conversations', method: 'POST', body: { visitorSessionId: 'visitor-session-1' } },
    { input: 'https://customer.example/api/widgets/demo-local-widget/messages?visitorSessionId=visitor-session-1&conversationId=conversation-1', method: 'GET', body: null },
  ]);
});

test('widget EventSource client keeps SSE live while catch-up polling advances from latest seq', async () => {
  const { subscribeToWidgetMessages } = loadModule(compiledChatModule);
  const receivedMessages = [];
  const readyEvents = [];
  const calls = [];
  const intervals = [];
  const clearedIntervals = [];
  const instances = [];
  const responses = [
    [],
    [sampleMessage({ id: 'message-4', seq: 4, sender: 'agent', body: 'Catch-up poll' })],
  ];

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.closed = false;
      instances.push(this);
    }

    addEventListener(event, listener) {
      this.listeners[event] = listener;
    }

    close() {
      this.closed = true;
    }
  }

  const subscription = subscribeToWidgetMessages('demo-local-widget', {
    visitorSessionId: 'visitor-session-1',
    conversationId: 'conversation-1',
    afterSeq: 2,
  }, {
    baseHref: 'https://customer.example/widget.html?publicKey=demo-local-widget',
    EventSourceImpl: FakeEventSource,
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });

      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: responses.shift() ?? [] }),
      };
    },
    pollIntervalMs: 25,
    setIntervalImpl: (listener, milliseconds) => {
      intervals.push({ listener, milliseconds });
      return intervals.length;
    },
    clearIntervalImpl: (intervalId) => clearedIntervals.push(intervalId),
    onMessage: (message) => receivedMessages.push(message),
    onReady: () => readyEvents.push('ready'),
  });

  assert.equal(instances.length, 1);
  assert.equal(
    instances[0].url,
    'https://customer.example/api/widgets/demo-local-widget/messages/events?visitorSessionId=visitor-session-1&conversationId=conversation-1&afterSeq=2',
  );
  assert.deepEqual(intervals.map((interval) => interval.milliseconds), [25]);
  assert.equal(instances[0].closed, false);
  await flushAsyncWork();
  assert.equal(
    calls[0].input,
    'https://customer.example/api/widgets/demo-local-widget/messages?visitorSessionId=visitor-session-1&conversationId=conversation-1&afterSeq=2',
  );
  assert.equal(instances[0].closed, false);

  instances[0].listeners.message({ data: JSON.stringify({ message: sampleMessage({ id: 'message-3', seq: 3 }) }) });
  instances[0].listeners.ready({});
  intervals[0].listener();
  await flushAsyncWork();

  assert.equal(
    calls[1].input,
    'https://customer.example/api/widgets/demo-local-widget/messages?visitorSessionId=visitor-session-1&conversationId=conversation-1&afterSeq=3',
  );
  assert.deepEqual(receivedMessages.map((message) => ({ id: message.id, seq: message.seq })), [
    { id: 'message-3', seq: 3 },
    { id: 'message-4', seq: 4 },
  ]);
  assert.deepEqual(readyEvents, ['ready']);
  assert.equal(instances[0].closed, false);

  subscription.close();

  assert.equal(instances[0].closed, true);
  assert.deepEqual(clearedIntervals, [1]);
});

test('widget subscription polls with latest seq when EventSource is unavailable and cleans up timers', async () => {
  const { applyWidgetChatMessage, createWidgetChatMessagesState, subscribeToWidgetMessages } = loadModule(compiledChatModule);
  const receivedMessages = [];
  const calls = [];
  const intervals = [];
  const clearedIntervals = [];
  const responses = [
    [sampleMessage({ id: 'message-3', seq: 3, sender: 'agent', body: 'First poll' })],
    [
      sampleMessage({ id: 'message-3', seq: 3, sender: 'agent', body: 'First poll duplicate' }),
      sampleMessage({ id: 'message-4', seq: 4, sender: 'agent', body: 'Second poll' }),
    ],
  ];
  const fetchImpl = async (input, init) => {
    calls.push({ input: String(input), init });

    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: responses.shift() ?? [] }),
    };
  };

  const subscription = subscribeToWidgetMessages('demo-local-widget', {
    visitorSessionId: 'visitor-session-1',
    conversationId: 'conversation-1',
    afterSeq: 2,
  }, {
    baseHref: 'https://customer.example/widget.html?publicKey=demo-local-widget',
    fetchImpl,
    pollIntervalMs: 25,
    setIntervalImpl: (listener, milliseconds) => {
      intervals.push({ listener, milliseconds });
      return intervals.length;
    },
    clearIntervalImpl: (intervalId) => clearedIntervals.push(intervalId),
    onMessage: (message) => receivedMessages.push(message),
  });

  assert.deepEqual(intervals.map((interval) => interval.milliseconds), [25]);
  await flushAsyncWork();

  assert.equal(
    calls[0].input,
    'https://customer.example/api/widgets/demo-local-widget/messages?visitorSessionId=visitor-session-1&conversationId=conversation-1&afterSeq=2',
  );
  assert.deepEqual(receivedMessages.map((message) => ({ id: message.id, seq: message.seq })), [
    { id: 'message-3', seq: 3 },
  ]);

  intervals[0].listener();
  await flushAsyncWork();

  assert.equal(
    calls[1].input,
    'https://customer.example/api/widgets/demo-local-widget/messages?visitorSessionId=visitor-session-1&conversationId=conversation-1&afterSeq=3',
  );

  const reducedState = receivedMessages.reduce(
    (state, message) => applyWidgetChatMessage(state, message),
    createWidgetChatMessagesState('conversation-1'),
  );
  assert.deepEqual(jsonSafe(reducedState.messages.map((message) => ({ id: message.id, body: message.body, seq: message.seq }))), [
    { id: 'message-3', body: 'First poll duplicate', seq: 3 },
    { id: 'message-4', body: 'Second poll', seq: 4 },
  ]);
  assert.equal(reducedState.latestSeq, 4);

  subscription.close();
  assert.deepEqual(clearedIntervals, [1]);

  intervals[0].listener();
  await flushAsyncWork();
  assert.equal(calls.length, 2);
});

test('widget subscription closes EventSource on error without adding duplicate catch-up timers', async () => {
  const { subscribeToWidgetMessages } = loadModule(compiledChatModule);
  const calls = [];
  const errorEvents = [];
  const intervals = [];
  const clearedIntervals = [];
  const instances = [];

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.closed = false;
      instances.push(this);
    }

    addEventListener(event, listener) {
      this.listeners[event] = listener;
    }

    close() {
      this.closed = true;
    }
  }

  const subscription = subscribeToWidgetMessages('demo-local-widget', {
    visitorSessionId: 'visitor-session-1',
    conversationId: 'conversation-1',
    afterSeq: 5,
  }, {
    baseHref: 'https://customer.example/widget.html?publicKey=demo-local-widget',
    EventSourceImpl: FakeEventSource,
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });

      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [] }),
      };
    },
    pollIntervalMs: 50,
    setIntervalImpl: (listener, milliseconds) => {
      intervals.push({ listener, milliseconds });
      return intervals.length;
    },
    clearIntervalImpl: (intervalId) => clearedIntervals.push(intervalId),
    onMessage: () => undefined,
    onError: () => errorEvents.push('error'),
  });

  assert.equal(instances.length, 1);
  assert.equal(instances[0].closed, false);
  assert.deepEqual(intervals.map((interval) => interval.milliseconds), [50]);
  await flushAsyncWork();
  assert.equal(
    calls[0].input,
    'https://customer.example/api/widgets/demo-local-widget/messages?visitorSessionId=visitor-session-1&conversationId=conversation-1&afterSeq=5',
  );

  instances[0].listeners.error({});
  await flushAsyncWork();

  assert.deepEqual(errorEvents, ['error']);
  assert.equal(instances[0].closed, true);
  assert.deepEqual(intervals.map((interval) => interval.milliseconds), [50]);
  assert.equal(calls.length, 1);

  intervals[0].listener();
  await flushAsyncWork();

  assert.equal(calls.length, 2);
  assert.equal(
    calls[1].input,
    'https://customer.example/api/widgets/demo-local-widget/messages?visitorSessionId=visitor-session-1&conversationId=conversation-1&afterSeq=5',
  );

  subscription.close();
  assert.deepEqual(clearedIntervals, [1]);
});

test('widget chat message state orders, deduplicates, tracks latest seq, and ignores other conversations', () => {
  const { applyWidgetChatMessage, createWidgetChatMessagesState } = loadModule(compiledChatModule);
  const initialState = createWidgetChatMessagesState('conversation-1', [
    sampleMessage({ id: 'message-2', seq: 2, sender: 'agent', body: 'Reply' }),
    sampleMessage({ id: 'message-1', seq: 1, body: 'Visitor' }),
  ]);

  assert.deepEqual(jsonSafe(initialState.messages.map((message) => message.seq)), [1, 2]);
  assert.equal(initialState.latestSeq, 2);

  const updatedState = applyWidgetChatMessage(initialState, sampleMessage({ id: 'message-1', seq: 1, body: 'Edited visitor' }));
  assert.deepEqual(jsonSafe(updatedState.messages.map((message) => message.body)), ['Edited visitor', 'Reply']);
  assert.equal(updatedState.latestSeq, 2);

  const ignoredState = applyWidgetChatMessage(updatedState, sampleMessage({
    id: 'other-message',
    conversationId: 'other-conversation',
    seq: 99,
    body: 'Wrong conversation',
  }));

  assert.deepEqual(jsonSafe(ignoredState), jsonSafe(updatedState));
});

test('widget visitor identity reuses valid stored keys and creates shared-contract keys when missing', () => {
  const { getOrCreateWidgetVisitorKey } = loadWidgetModule(compiledWidgetVisitorIdentityModule);
  const storageKey = sharedVisitorIdentity.buildVisitorKeyStorageKey('demo-local-widget');
  const storedVisitorKey = `pvk_${'A'.repeat(43)}`;
  const reusedStorage = createFakeStorage({ [storageKey]: storedVisitorKey });

  assert.equal(
    getOrCreateWidgetVisitorKey('demo-local-widget', {
      storage: reusedStorage,
      cryptoImpl: { getRandomValues: () => { throw new Error('stored key should not generate'); } },
    }),
    storedVisitorKey,
  );

  const generatedStorage = createFakeStorage({ [storageKey]: 'invalid-key' });
  const generatedVisitorKey = getOrCreateWidgetVisitorKey('demo-local-widget', {
    storage: generatedStorage,
    cryptoImpl: {
      getRandomValues: (bytes) => {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = index;
        }

        return bytes;
      },
    },
  });

  assert.deepEqual(jsonSafe(sharedVisitorIdentity.parseVisitorKey(generatedVisitorKey)), {
    status: 'valid',
    visitorKey: generatedVisitorKey,
  });
  assert.equal(generatedStorage.entries[storageKey], generatedVisitorKey);
  assert.equal(generatedVisitorKey.length, 47);
});


test('widget public key parser reads configured, encoded, and missing keys', () => {
  const { readWidgetPublicKey } = loadModule(compiledPublicKeyModule);

  assert.deepEqual(jsonSafe(readWidgetPublicKey('?publicKey=demo-local-widget')), {
    status: 'configured',
    publicKey: 'demo-local-widget',
  });
  assert.deepEqual(jsonSafe(readWidgetPublicKey('?publicKey=%20encoded%2Fwidget%20')), {
    status: 'configured',
    publicKey: 'encoded/widget',
  });
  assert.deepEqual(jsonSafe(readWidgetPublicKey('?unused=value')), { status: 'missing_key' });
  assert.deepEqual(jsonSafe(readWidgetPublicKey('?publicKey=%20%20')), { status: 'missing_key' });
});

test('widget bootstrap client builds a safely encoded current-origin URL', () => {
  const { buildWidgetBootstrapUrl } = loadModule(compiledBootstrapModule);

  assert.equal(
    buildWidgetBootstrapUrl('demo key/with?chars', 'https://customer.example/widget.html?publicKey=demo'),
    'https://customer.example/api/widgets/demo%20key%2Fwith%3Fchars/bootstrap',
  );
});

test('widget bootstrap client fetches bootstrap JSON for configured keys', async () => {
  const { loadWidgetBootstrap } = loadModule(compiledBootstrapModule);
  const calls = [];
  const bootstrap = sampleBootstrap('demo-local-widget');
  const fetchImpl = async (input, init) => {
    calls.push({ input: String(input), init });

    return {
      ok: true,
      status: 200,
      json: async () => bootstrap,
    };
  };

  const result = await loadWidgetBootstrap('demo-local-widget', {
    baseHref: 'https://customer.example/widget.html?publicKey=demo-local-widget',
    fetchImpl,
  });

  assert.deepEqual(jsonSafe(result), { status: 'loaded', bootstrap });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, 'https://customer.example/api/widgets/demo-local-widget/bootstrap');
  assert.equal(calls[0].init.method, 'GET');
  assert.deepEqual(jsonSafe(calls[0].init.headers), { Accept: 'application/json' });
  assert.equal(calls[0].init.credentials, 'same-origin');
});

test('widget bootstrap client does not fetch without a configured key', async () => {
  const { loadWidgetBootstrap } = loadModule(compiledBootstrapModule);
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    throw new Error('missing key should not fetch');
  };

  const result = await loadWidgetBootstrap(null, {
    baseHref: 'https://customer.example/widget.html',
    fetchImpl,
  });

  assert.deepEqual(jsonSafe(result), { status: 'missing_key' });
  assert.equal(fetchCalls, 0);
});

test('widget bootstrap client fails closed for non-OK and network errors', async () => {
  const { loadWidgetBootstrap } = loadModule(compiledBootstrapModule);

  const nonOkResult = await loadWidgetBootstrap('demo-local-widget', {
    baseHref: 'https://customer.example/widget.html?publicKey=demo-local-widget',
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'origin_not_allowed' }),
    }),
  });

  assert.deepEqual(jsonSafe(nonOkResult), { status: 'error', reason: 'request_failed' });

  const networkResult = await loadWidgetBootstrap('demo-local-widget', {
    baseHref: 'https://customer.example/widget.html?publicKey=demo-local-widget',
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });

  assert.deepEqual(jsonSafe(networkResult), { status: 'error', reason: 'request_failed' });
});
