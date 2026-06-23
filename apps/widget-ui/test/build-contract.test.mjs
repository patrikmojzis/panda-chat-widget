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
const compiledPublicKeyModule = ts.transpileModule(publicKeySource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

function loadPublicKeyModule() {
  const module = { exports: {} };

  vm.runInNewContext(
    compiledPublicKeyModule,
    {
      exports: module.exports,
      module,
      URLSearchParams,
    },
    { timeout: 1000 },
  );

  return module.exports;
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
  assert.match(mainSource, /createRoot\(rootElement\)\.render/);
  assert.match(mainSource, /<StrictMode>/);
  assert.match(mainSource, /<App widgetPublicKey=\{widgetPublicKey\} \/>/);
});

test('widget UI renders configured and missing-key placeholders only', () => {
  assert.match(appSource, /Loaded placeholder for widget key/);
  assert.match(appSource, /Missing widget key/);
  assert.match(appSource, /data-state=\{widgetPublicKey\.status\}/);
  assert.match(stylesSource, /\.widget-shell/);
  assert.match(viteEnvSource, /vite\/client/);
  assert.doesNotMatch(`${mainSource}\n${appSource}`, /fetch\(|XMLHttpRequest|postMessage|theme|composer|message/i);
});

test('widget public key parser reads configured, encoded, and missing keys', () => {
  const { readWidgetPublicKey } = loadPublicKeyModule();

  assert.deepEqual(JSON.parse(JSON.stringify(readWidgetPublicKey('?publicKey=demo-local-widget'))), {
    status: 'configured',
    publicKey: 'demo-local-widget',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(readWidgetPublicKey('?publicKey=%20encoded%2Fwidget%20'))), {
    status: 'configured',
    publicKey: 'encoded/widget',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(readWidgetPublicKey('?unused=value'))), { status: 'missing_key' });
  assert.deepEqual(JSON.parse(JSON.stringify(readWidgetPublicKey('?publicKey=%20%20'))), { status: 'missing_key' });
});
