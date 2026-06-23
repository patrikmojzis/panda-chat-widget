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

test('widget UI renders bootstrap loading, missing, and error placeholders only', () => {
  assert.match(appSource, /Loading widget configuration/);
  assert.match(appSource, /Missing widget key/);
  assert.match(appSource, /Widget configuration could not be loaded/);
  assert.match(appSource, /data-state=\{bootstrapState\.status\}/);
  assert.match(stylesSource, /\.widget-shell/);
  assert.match(viteEnvSource, /vite\/client/);
  assert.doesNotMatch(`${mainSource}\n${appSource}`, /XMLHttpRequest|postMessage|theme|composer|send/i);
});

test('loaded bootstrap renders config-driven welcome text safely', () => {
  assert.match(appSource, /<WelcomeState bootstrap=\{state\.bootstrap\} \/>/);
  assert.match(appSource, /assistant\.displayName/);
  assert.match(appSource, /welcome\.title/);
  assert.match(appSource, /welcome\.subtitle/);
  assert.match(appSource, /\{assistant\.displayName\}/);
  assert.match(appSource, /\{welcome\.title\}/);
  assert.match(appSource, /\{welcome\.subtitle\}/);
  assert.match(appSource, /The chat will appear here when the conversation UI is ready/);
  assert.match(stylesSource, /\.widget-welcome/);
  assert.doesNotMatch(`${appSource}\n${stylesSource}`, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|theme\./);
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
