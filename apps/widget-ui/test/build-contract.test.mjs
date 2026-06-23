import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const viteEnvSource = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

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
  assert.match(mainSource, /createRoot\(rootElement\)\.render/);
  assert.match(mainSource, /<StrictMode>/);
  assert.match(mainSource, /<App \/>/);
});

test('widget UI renders a placeholder shell only', () => {
  assert.match(appSource, /Iframe app shell/);
  assert.match(appSource, /React placeholder confirms the iframe app mounted/);
  assert.match(stylesSource, /\.widget-shell/);
  assert.match(viteEnvSource, /vite\/client/);
  assert.doesNotMatch(`${mainSource}\n${appSource}`, /fetch\(|XMLHttpRequest|postMessage|URLSearchParams|location\.search|publicKey|composer|message/i);
});
