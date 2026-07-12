import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as ts from 'typescript';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const composerSource = await readFile(new URL('../src/widget-composer.ts', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const viteEnvSource = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
const publicKeySource = await readFile(new URL('../src/widget-public-key.ts', import.meta.url), 'utf8');
const bootstrapSource = await readFile(new URL('../src/widget-bootstrap.ts', import.meta.url), 'utf8');
const themeSource = await readFile(new URL('../src/widget-theme.ts', import.meta.url), 'utf8');
const chatSource = await readFile(new URL('../src/widget-chat.ts', import.meta.url), 'utf8');
const widgetVisitorIdentitySource = await readFile(new URL('../src/widget-visitor-identity.ts', import.meta.url), 'utf8');
const sharedVisitorIdentitySource = await readFile(new URL('../../../packages/shared/src/visitor-identity.ts', import.meta.url), 'utf8');
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
const sharedVisitorIdentity = loadModule(compileTypeScript(sharedVisitorIdentitySource), { encodeURIComponent });

function loadWidgetModule(compiledSource) {
  return loadModule(compiledSource, {
    require: (specifier) => {
      if (specifier.includes('packages/shared/src/visitor-identity')) {
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
  assert.equal(packageJson.scripts.build, 'tsc -p tsconfig.json --noEmit --pretty false && vite build');
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

test('widget UI renders bootstrap states and a minimal live chat shell', () => {
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
  assert.match(appSource, /No messages yet/);
  assert.match(stylesSource, /\.widget-shell/);
  assert.match(viteEnvSource, /vite\/client/);
  assert.doesNotMatch(`${mainSource}
${appSource}
${composerSource}
${chatSource}`, /XMLHttpRequest|postMessage|Gateway|WebSocket/i);
  assert.doesNotMatch(`${mainSource}
${appSource}
${composerSource}
${bootstrapSource}
${chatSource}`, ownerOnlyLocalDeliveryPattern);
});


test('widget UI shell sizing stays inside iframe bounds responsively', () => {
  assert.match(stylesSource, /html,\s*\nbody,\s*\n#root \{\s*height: 100%;/);
  assert.match(stylesSource, /body \{[\s\S]*min-width: 0;[\s\S]*min-height: 100%;[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /\.widget-shell \{[\s\S]*width: 100%;[\s\S]*max-width: 100%;[\s\S]*height: 100%;[\s\S]*min-height: 100%;/);
  assert.match(stylesSource, /grid-template-rows: auto minmax\(0, 1fr\);/);
  assert.match(stylesSource, /\.widget-shell \{[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /env\(safe-area-inset-top, 0px\)/);
  assert.match(stylesSource, /env\(safe-area-inset-right, 0px\)/);
  assert.match(stylesSource, /env\(safe-area-inset-bottom, 0px\)/);
  assert.match(stylesSource, /env\(safe-area-inset-left, 0px\)/);
  assert.match(stylesSource, /@media \(max-width: 359px\), \(max-height: 420px\)/);
  assert.match(stylesSource, /overflow-wrap: anywhere;/);
  assert.match(stylesSource, /\.widget-welcome \{[\s\S]*width: 100%;[\s\S]*max-width: 336px;[\s\S]*justify-self: center;[\s\S]*min-height: 0;[\s\S]*overflow: hidden;/);
  assert.doesNotMatch(`${mainSource}\n${appSource}\n${stylesSource}`, /postMessage|ResizeObserver|window\.parent|parent\.postMessage/i);
});

test('mobile safe-area chat CSS keeps messages scrollable and composer reachable', () => {
  assert.match(stylesSource, /\.widget-chat \{[\s\S]*min-height: 0;[\s\S]*grid-template-rows: minmax\(0, 1fr\) auto;[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /\.widget-chat__messages \{[\s\S]*overflow-y: auto;[\s\S]*overscroll-behavior: contain;[\s\S]*scroll-padding-block: 8px max\(8px, env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(stylesSource, /\.widget-chat__message \{[\s\S]*max-width: 86%;[\s\S]*overflow-wrap: anywhere;/);
  assert.match(stylesSource, /\.widget-chat__composer \{[\s\S]*position: relative;[\s\S]*z-index: 1;[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*padding-bottom: max\(0px, env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(stylesSource, /\.widget-chat__composer textarea \{[\s\S]*width: 100%;[\s\S]*max-width: 100%;[\s\S]*min-width: 0;[\s\S]*max-height: 96px;[\s\S]*resize: none;/);
  assert.match(stylesSource, /\.widget-chat__composer button \{[\s\S]*min-width: 0;[\s\S]*white-space: nowrap;/);
  assert.match(stylesSource, /@media \(max-width: 359px\), \(max-height: 420px\) \{[\s\S]*\.widget-welcome \{[\s\S]*gap: 10px;[\s\S]*padding: 14px;[\s\S]*\.widget-chat__message \{[\s\S]*max-width: 92%;[\s\S]*\.widget-chat__composer textarea,[\s\S]*\.widget-chat__composer button \{[\s\S]*padding: 9px 10px;/);
  assert.match(stylesSource, /@media \(max-width: 279px\) \{[\s\S]*\.widget-chat__composer \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);[\s\S]*align-items: stretch;[\s\S]*\.widget-chat__composer button \{[\s\S]*width: 100%;/);
  assert.doesNotMatch(`${mainSource}\n${appSource}\n${stylesSource}`, /postMessage|ResizeObserver|window\.parent|parent\.postMessage/i);
});

test('widget states keep static live text separate from optional actions', () => {
  // Source proves wiring only; Chromium must prove remount identity, announcements, focus, and races.
  const stateMessage = appSource.match(/function WidgetStateMessage[\s\S]*?\n}\n\ntype WelcomeStateProps/)?.[0] ?? '';

  assert.match(stateMessage, /<section className=\{`widget-state widget-state--\$\{tone\}`\}>/);
  assert.match(stateMessage, /<div key=\{role\} className="widget-state__content" role=\{role\} aria-live=/);
  assert.match(stateMessage, /<\/div>\s*\{action\}\s*<\/section>/);
  assert.doesNotMatch(stateMessage.match(/<section[^>]*>/)?.[0] ?? '', /role=|aria-live=/);
  assert.match(appSource, /title="Loading chat…" body="This should only take a moment\."/);
  assert.match(appSource, /title="Starting chat…" body="Connecting you now\."/);
  assert.match(appSource, /title="No messages yet" body="Send a message below to start the conversation\."/);
  assert.match(appSource, /title="Chat is unavailable" body="Please try again later\." role="alert"/);
  assert.match(stylesSource, /\.widget-state__content \{[\s\S]*display: grid;[\s\S]*place-items: center;/);
  assert.doesNotMatch(`${appSource}\n${stylesSource}`, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|style=|cssText|url\(/);
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

  assert.match(stylesSource, /--widget-state-action-focus-color: #0f172a;/);
  assert.match(stylesSource, /\.widget-state__action \{[\s\S]*min-height: 44px;[\s\S]*background: var\(--widget-accent-color\);/);
  assert.match(stylesSource, /\.widget-state__action:focus-visible \{\s*outline: 3px solid var\(--widget-state-action-focus-color\);/);
  assert.match(stylesSource, /\.widget-welcome\[data-color-mode="dark"\],[\s\S]*--widget-state-action-focus-color: #ffffff;/);
  assert.match(stylesSource, /@media \(prefers-color-scheme: dark\) \{[\s\S]*\.widget-welcome\[data-color-mode="system"\],[\s\S]*--widget-state-action-focus-color: #ffffff;/);

  assert.doesNotMatch(widgetChat, /AbortController|setTimeout|setInterval|localStorage|sessionStorage|\bfetch\(|XMLHttpRequest|sendBeacon|console\./);
  assert.doesNotMatch(
    `${bootstrapSource}\n${chatSource}\n${widgetVisitorIdentitySource}\n${sharedVisitorIdentitySource}`,
    /initializationAttempt|retryPendingRef|widget-state__action|Try again now, or come back later\./,
  );
});

test('chat panel message layout keeps messages scrollable and wrapped', () => {
  assert.match(appSource, /className="widget-chat__messages"[\s\S]*aria-live="polite"[\s\S]*ref=\{messageScrollRef\}/);
  assert.match(appSource, /<WidgetStateMessage tone="empty" title="No messages yet"/);
  assert.match(appSource, /className="widget-chat__message-list"/);
  assert.match(appSource, /data-sender=\{message\.sender\}/);
  assert.match(stylesSource, /\.widget-chat \{[\s\S]*min-height: 0;[\s\S]*grid-template-rows: minmax\(0, 1fr\) auto;/);
  assert.match(stylesSource, /\.widget-chat__messages \{[\s\S]*min-height: 0;[\s\S]*overflow-x: hidden;[\s\S]*overflow-y: auto;/);
  assert.match(stylesSource, /\.widget-chat__message-list \{[\s\S]*display: grid;[\s\S]*list-style: none;/);
  assert.match(stylesSource, /\.widget-chat__message \{[\s\S]*max-width: 86%;[\s\S]*justify-self: start;/);
  assert.match(stylesSource, /\.widget-chat__message\[data-sender="visitor"\] \{[\s\S]*justify-self: end;[\s\S]*background: var\(--widget-accent-color\);/);
  assert.match(stylesSource, /\.widget-chat__message\[data-sender="agent"\],[\s\S]*\.widget-chat__message\[data-sender="system"\] \{[\s\S]*justify-self: start;/);
  assert.match(stylesSource, /\.widget-chat__message p \{[\s\S]*overflow-wrap: anywhere;[\s\S]*white-space: pre-wrap;/);
  assert.match(stylesSource, /\.widget-chat__composer \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.doesNotMatch(`${appSource}
${stylesSource}`, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|style=|cssText|url\(/);
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

  assert.match(appSource, /<div className="widget-chat__message-region">[\s\S]*className="widget-chat__messages"[\s\S]*\{showJumpToLatest \? \([\s\S]*widget-chat__jump-to-latest[\s\S]*<\/div>\s*<form/);
  assert.match(stylesSource, /\.widget-chat__message-region \{[\s\S]*position: relative;[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /\.widget-chat__jump-to-latest \{[\s\S]*position: absolute;[\s\S]*min-height: 44px;[\s\S]*color: [^;]+;[\s\S]*background: [^;]+;/);
  assert.match(stylesSource, /\.widget-chat__jump-to-latest:focus-visible \{[\s\S]*outline: 3px solid var\(--widget-accent-focus-color\);/);
  assert.match(stylesSource, /\.widget-welcome\[data-color-mode="dark"\] \.widget-chat__jump-to-latest,[\s\S]*\{[\s\S]*color: [^;]+;[\s\S]*background: [^;]+;/);
  assert.match(stylesSource, /@media \(prefers-color-scheme: dark\) \{[\s\S]*\.widget-welcome\[data-color-mode="system"\] \.widget-chat__jump-to-latest/);
  assert.doesNotMatch(`${appSource}\n${stylesSource}`, /ResizeObserver|\bscroll-behavior|behavior:\s*['"]smooth['"]|autoFocus|postMessage|window\.parent|parent\.postMessage/i);
});

test('composer interaction exposes multiline textarea submit affordance and accessible states', () => {
  assert.match(appSource, /const isSending = chatState\.sendStatus === 'sending';/);
  assert.match(appSource, /const canSend = !isSending && draftMessage\.trim\(\)\.length > 0;/);
  assert.match(appSource, /function submitDraftMessage\(\) \{[\s\S]*chatState\.status !== 'ready' \|\| chatState\.sendStatus === 'sending'[\s\S]*const body = draftMessage\.trim\(\);[\s\S]*if \(!body\)/);
  assert.match(appSource, /Press Enter to send\. Shift\+Enter for a new line\./);
  assert.match(appSource, /Sending your message/);
  assert.match(appSource, /Couldn’t send\. Try again\./);
  assert.match(appSource, /<form[\s\S]*className="widget-chat__composer"[\s\S]*onSubmit=\{handleSubmit\}[\s\S]*data-send-status=\{chatState\.sendStatus\}[\s\S]*aria-busy=\{isSending\}/);
  assert.match(appSource, /htmlFor="widget-chat-message-input"/);
  assert.match(appSource, /<textarea[\s\S]*id="widget-chat-message-input"[\s\S]*rows=\{3\}/);
  assert.match(appSource, /onKeyDown=\{handleComposerKeyDown\}/);
  assert.match(appSource, /resolveWidgetComposerKeyAction\(event, draftMessage\)/);
  assert.match(appSource, /placeholder="Type your message…"/);
  assert.match(appSource, /autoComplete="off"/);
  assert.match(appSource, /aria-describedby="widget-chat-composer-status"/);
  assert.match(appSource, /disabled=\{isSending\}/);
  assert.match(appSource, /<button type="submit" disabled=\{!canSend\}/);
  assert.match(appSource, /aria-label=\{isSending \? 'Sending message' : 'Send message'\}/);
  assert.match(appSource, /role=\{composerStatusRole\}/);
  assert.match(stylesSource, /\.widget-chat__composer-field \{[\s\S]*min-width: 0;[\s\S]*display: grid;/);
  assert.match(stylesSource, /\.widget-chat__composer textarea \{[\s\S]*min-height: 74px;[\s\S]*max-height: 96px;[\s\S]*resize: none;/);
  assert.match(stylesSource, /\.widget-chat__composer textarea::placeholder \{[\s\S]*color: #94a3b8;/);
  assert.match(stylesSource, /\.widget-chat__composer textarea:focus-visible,[\s\S]*\.widget-chat__composer button:focus-visible \{[\s\S]*outline: 2px solid var\(--widget-accent-focus-color\);/);
  assert.match(stylesSource, /\.widget-chat__composer button:disabled \{[\s\S]*background: #94a3b8;/);
  assert.match(stylesSource, /\.widget-chat__composer-status \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*min-height: 18px;/);
  assert.match(stylesSource, /\.widget-chat__composer\[data-send-status="sending"\] \.widget-chat__composer-status \{[\s\S]*color: var\(--widget-accent-color\);/);
  assert.match(stylesSource, /\.widget-chat__composer\[data-send-status="error"\] textarea \{[\s\S]*border-color: #dc2626;/);
  assert.match(stylesSource, /\.widget-chat__composer\[data-send-status="error"\] \.widget-chat__composer-status \{[\s\S]*color: #dc2626;[\s\S]*font-weight: 700;/);
  assert.doesNotMatch(appSource, /<input|type="text"|onKeyUp/);
  assert.doesNotMatch(`${appSource}
${composerSource}
${stylesSource}`, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|style=|cssText|url\(/);
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

test('chat surface uses safe branding tokens from data attributes', () => {
  assert.match(appSource, /data-color-mode=\{theme\.colorMode\}/);
  assert.match(appSource, /data-accent=\{theme\.accent\}/);
  assert.match(appSource, /data-radius=\{theme\.radius\}/);
  assert.match(stylesSource, /\.widget-welcome\[data-accent="blue"\] \{[\s\S]*--widget-accent-color: #2563eb;[\s\S]*--widget-accent-border-color: #3b82f6;[\s\S]*--widget-accent-focus-color: #93c5fd;/);
  assert.match(stylesSource, /\.widget-welcome\[data-radius="md"\] \{[\s\S]*--widget-panel-radius: 16px;[\s\S]*--widget-card-radius: 14px;[\s\S]*--widget-tail-radius: 4px;[\s\S]*--widget-pill-radius: 999px;/);
  assert.match(stylesSource, /\.widget-welcome--accent-blue \.widget-welcome__assistant \{[\s\S]*color: var\(--widget-accent-color\);/);
  assert.match(stylesSource, /\.widget-chat__message \{[\s\S]*border-radius: var\(--widget-card-radius\);[\s\S]*border-bottom-left-radius: var\(--widget-tail-radius\);/);
  assert.match(stylesSource, /\.widget-chat__message\[data-sender="visitor"\] \{[\s\S]*border-color: var\(--widget-accent-color\);[\s\S]*background: var\(--widget-accent-color\);/);
  assert.match(stylesSource, /\.widget-chat__composer textarea \{[\s\S]*border-radius: var\(--widget-card-radius\);/);
  assert.match(stylesSource, /\.widget-chat__composer textarea:focus-visible \{[\s\S]*border-color: var\(--widget-accent-color\);/);
  assert.match(stylesSource, /\.widget-chat__composer button \{[\s\S]*border-radius: var\(--widget-pill-radius\);[\s\S]*background: var\(--widget-accent-color\);/);
  assert.match(stylesSource, /\.widget-chat__composer\[data-send-status="sending"\] \.widget-chat__composer-status \{[\s\S]*color: var\(--widget-accent-color\);/);
  assert.match(stylesSource, /\.widget-welcome\[data-color-mode="dark"\] \.widget-chat__message\[data-sender="visitor"\],[\s\S]*\.widget-welcome--mode-dark \.widget-chat__message\[data-sender="visitor"\] \{[\s\S]*border-color: var\(--widget-accent-border-color\);[\s\S]*background: var\(--widget-accent-color\);/);
  assert.match(stylesSource, /@media \(prefers-color-scheme: dark\) \{[\s\S]*\.widget-welcome\[data-color-mode="system"\] \.widget-chat__message\[data-sender="visitor"\]/);
  assert.doesNotMatch(`${appSource}
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
  assert.match(appSource, /\{assistant\.displayName\}/);
  assert.match(appSource, /\{welcome\.title\}/);
  assert.match(appSource, /\{welcome\.subtitle\}/);
  assert.match(appSource, /<WidgetChat publicKey=\{bootstrap\.widget\.publicKey\}/);
  assert.match(appSource, /assistantName=\{assistant\.displayName\}/);
  assert.match(appSource, /aria-label=\{`\$\{assistantName\} conversation`\}/);
  assert.match(appSource, /<strong>\{message\.sender === 'visitor' \? 'You' : assistantName\}<\/strong>/);
  assert.match(stylesSource, /\.widget-welcome/);
  assert.match(stylesSource, /\.widget-welcome--mode-light/);
  assert.match(stylesSource, /\.widget-welcome--mode-dark/);
  assert.match(stylesSource, /\.widget-welcome--mode-system/);
  assert.match(stylesSource, /\.widget-welcome--accent-blue/);
  assert.match(stylesSource, /\.widget-welcome--radius-md/);
  assert.doesNotMatch(`${appSource}
${stylesSource}`, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|style=|cssText|url\(/);
});


test('theme config path has no arbitrary CSS or HTML injection surface', () => {
  const themeProductSources = [
    mainSource,
    appSource,
    composerSource,
    bootstrapSource,
    themeSource,
    chatSource,
    widgetVisitorIdentitySource,
    stylesSource,
  ].join('\n');

  assert.match(themeSource, /const COLOR_MODE_CLASS_NAMES = \{[\s\S]*light: 'widget-welcome--mode-light',[\s\S]*dark: 'widget-welcome--mode-dark',[\s\S]*system: 'widget-welcome--mode-system',[\s\S]*\} as const satisfies Record<WidgetBootstrapConfig\['theme'\]\['colorMode'\], string>/);
  assert.match(themeSource, /const ACCENT_CLASS_NAMES = \{[\s\S]*blue: 'widget-welcome--accent-blue',[\s\S]*\} as const satisfies Record<WidgetBootstrapConfig\['theme'\]\['accent'\], string>/);
  assert.match(themeSource, /const RADIUS_CLASS_NAMES = \{[\s\S]*md: 'widget-welcome--radius-md',[\s\S]*\} as const satisfies Record<WidgetBootstrapConfig\['theme'\]\['radius'\], string>/);
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
    className: 'widget-welcome--mode-dark widget-welcome--accent-blue widget-welcome--radius-md',
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
    className: 'widget-welcome--mode-system widget-welcome--accent-blue widget-welcome--radius-md',
  });
  assert.doesNotMatch(resolvedTheme.className, /background|javascript|999px|url/);
  assert.deepEqual(jsonSafe(resolveWidgetTheme()), {
    colorMode: 'system',
    accent: 'blue',
    radius: 'md',
    className: 'widget-welcome--mode-system widget-welcome--accent-blue widget-welcome--radius-md',
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
