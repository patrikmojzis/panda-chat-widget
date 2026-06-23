import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as ts from 'typescript';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const viteEnvSource = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
const publicKeySource = await readFile(new URL('../src/widget-public-key.ts', import.meta.url), 'utf8');
const bootstrapSource = await readFile(new URL('../src/widget-bootstrap.ts', import.meta.url), 'utf8');
const themeSource = await readFile(new URL('../src/widget-theme.ts', import.meta.url), 'utf8');
const chatSource = await readFile(new URL('../src/widget-chat.ts', import.meta.url), 'utf8');
const widgetVisitorIdentitySource = await readFile(new URL('../src/widget-visitor-identity.ts', import.meta.url), 'utf8');
const sharedVisitorIdentitySource = await readFile(new URL('../../../packages/shared/src/visitor-identity.ts', import.meta.url), 'utf8');

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
  assert.match(appSource, /Loading widget configuration/);
  assert.match(appSource, /Missing widget key/);
  assert.match(appSource, /Widget configuration could not be loaded/);
  assert.match(appSource, /data-state=\{bootstrapState\.status\}/);
  assert.match(appSource, /getOrCreateWidgetVisitorKey/);
  assert.match(appSource, /createWidgetVisitorSession/);
  assert.match(appSource, /createWidgetConversation/);
  assert.match(appSource, /listWidgetMessages/);
  assert.match(appSource, /subscribeToWidgetMessages/);
  assert.match(appSource, /sendWidgetMessage/);
  assert.match(appSource, /Starting chat/);
  assert.match(appSource, /Send a message to start the conversation/);
  assert.match(stylesSource, /\.widget-shell/);
  assert.match(viteEnvSource, /vite\/client/);
  assert.doesNotMatch(`${mainSource}
${appSource}
${chatSource}`, /XMLHttpRequest|postMessage|Gateway|WebSocket/i);
});


test('widget UI shell sizing stays inside iframe bounds responsively', () => {
  assert.match(stylesSource, /html,\s*\nbody,\s*\n#root \{\s*height: 100%;/);
  assert.match(stylesSource, /body \{[\s\S]*min-width: 0;[\s\S]*min-height: 100%;[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /\.widget-shell \{[\s\S]*width: 100%;[\s\S]*max-width: 100%;[\s\S]*height: 100%;[\s\S]*min-height: 100%;/);
  assert.match(stylesSource, /grid-template-rows: auto minmax\(0, 1fr\);/);
  assert.match(stylesSource, /overflow-x: hidden;/);
  assert.match(stylesSource, /overflow-y: auto;/);
  assert.match(stylesSource, /env\(safe-area-inset-top, 0px\)/);
  assert.match(stylesSource, /env\(safe-area-inset-right, 0px\)/);
  assert.match(stylesSource, /env\(safe-area-inset-bottom, 0px\)/);
  assert.match(stylesSource, /env\(safe-area-inset-left, 0px\)/);
  assert.match(stylesSource, /@media \(max-width: 359px\), \(max-height: 420px\)/);
  assert.match(stylesSource, /overflow-wrap: anywhere;/);
  assert.match(stylesSource, /\.widget-welcome \{[\s\S]*width: 100%;[\s\S]*max-width: 336px;[\s\S]*justify-self: center;/);
  assert.doesNotMatch(`${mainSource}\n${appSource}\n${stylesSource}`, /postMessage|ResizeObserver|window\.parent|parent\.postMessage/i);
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
  assert.match(stylesSource, /\.widget-welcome/);
  assert.match(stylesSource, /\.widget-welcome--mode-light/);
  assert.match(stylesSource, /\.widget-welcome--mode-dark/);
  assert.match(stylesSource, /\.widget-welcome--mode-system/);
  assert.match(stylesSource, /\.widget-welcome--accent-blue/);
  assert.match(stylesSource, /\.widget-welcome--radius-md/);
  assert.doesNotMatch(`${appSource}
${stylesSource}`, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|style=|cssText|url\(/);
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

test('widget EventSource client subscribes to the live message endpoint and handles message events', () => {
  const { subscribeToWidgetMessages } = loadModule(compiledChatModule);
  const receivedMessages = [];
  const readyEvents = [];
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
    afterSeq: 2,
  }, {
    baseHref: 'https://customer.example/widget.html?publicKey=demo-local-widget',
    EventSourceImpl: FakeEventSource,
    onMessage: (message) => receivedMessages.push(message),
    onReady: () => readyEvents.push('ready'),
  });

  assert.equal(instances.length, 1);
  assert.equal(
    instances[0].url,
    'https://customer.example/api/widgets/demo-local-widget/messages/events?visitorSessionId=visitor-session-1&conversationId=conversation-1&afterSeq=2',
  );

  instances[0].listeners.message({ data: JSON.stringify({ message: sampleMessage({ id: 'message-3', seq: 3 }) }) });
  instances[0].listeners.ready({});
  subscription.close();

  assert.deepEqual(receivedMessages.map((message) => ({ id: message.id, seq: message.seq })), [
    { id: 'message-3', seq: 3 },
  ]);
  assert.deepEqual(readyEvents, ['ready']);
  assert.equal(instances[0].closed, true);
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

test('widget subscription falls back to polling on EventSource errors', async () => {
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
  assert.equal(calls.length, 0);

  instances[0].listeners.error({});
  await flushAsyncWork();

  assert.deepEqual(errorEvents, ['error']);
  assert.equal(instances[0].closed, true);
  assert.deepEqual(intervals.map((interval) => interval.milliseconds), [50]);
  assert.equal(
    calls[0].input,
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
