import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const buildConfig = JSON.parse(await readFile(new URL('../tsconfig.build.json', import.meta.url), 'utf8'));

test('loader package maps only the ESM, declaration, and classic public artifacts', () => {
  assert.equal(packageJson.browser, 'dist/panda-chat-widget-loader.js');
  assert.equal(packageJson.main, 'dist/panda-chat-widget-loader.js');
  assert.deepEqual(packageJson.exports, {
    '.': { import: './dist/index.js', types: './dist/index.d.ts' },
    './classic': './dist/panda-chat-widget-loader.js',
  });
  assert.equal(packageJson.scripts.test.includes('vite build --mode test-core'), true);
  assert.equal(packageJson.scripts.test.includes('test/declarations/tsconfig.json'), true);
});

test('build config emits declarations for the public API', () => {
  assert.equal(buildConfig.compilerOptions.declaration, true);
  assert.equal(buildConfig.compilerOptions.emitDeclarationOnly, true);
  assert.equal(buildConfig.compilerOptions.declarationDir, './dist');
});

test('ESM entry source remains side-effect-free', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /window\b|PandaChatWidgetLoader|PandaChatWidgetConfig|document\.body|postMessage/);
  assert.match(source, /createPandaChatWidget/);
  assert.match(source, /PandaChatWidgetError/);
});

test('classic source retains globals without prohibited bridge or auth methods', async () => {
  const source = await readFile(new URL('../src/classic.ts', import.meta.url), 'utf8');
  assert.match(source, /PandaChatWidgetLoader/);
  assert.match(source, /PandaChatWidgetConfig/);
  assert.match(source, /PandaChatWidget/);
  assert.match(source, /data-public-key|data-widget-key|data-site-key/);
  assert.doesNotMatch(source, /postMessage|signIn|signOut/);
});

test('production source contains no bridge, auth method, or public test hook spill', async () => {
  const sourceFiles = [
    '../src/types.ts', '../src/errors.ts', '../src/core.ts',
    '../src/normalize.ts', '../src/lease.ts', '../src/driver.ts',
    '../src/iframe-driver.ts', '../src/index.ts', '../src/classic.ts',
  ];
  for (const file of sourceFiles) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /postMessage|signIn|signOut/, `${file} has prohibited API spill`);
    assert.doesNotMatch(source, /__test|testHook|testDriver/, `${file} exposes a test hook`);
  }
});

test('fresh public artifacts exist and have their intended module formats', async () => {
  const dist = new URL('../dist/', import.meta.url);
  await access(new URL('index.js', dist));
  await access(new URL('index.d.ts', dist));
  await access(new URL('panda-chat-widget-loader.js', dist));

  const esm = await readFile(new URL('index.js', dist), 'utf8');
  assert.match(esm, /createPandaChatWidget/);
  assert.match(esm, /PandaChatWidgetError/);
  assert.match(esm, /^export\s*\{/m);
  assert.doesNotMatch(esm, /window\.PandaChatWidget/);

  const classic = await readFile(new URL('panda-chat-widget-loader.js', dist), 'utf8');
  assert.match(classic, /PandaChatWidgetLoader/);
  assert.doesNotMatch(classic, /^export |^import /m);
});

test('public declarations expose no internal controller, test seam, or auth methods', async () => {
  const declaration = await readFile(new URL('../dist/index.d.ts', import.meta.url), 'utf8');
  assert.match(declaration, /PandaChatWidgetLifecycle/);
  assert.match(declaration, /PandaChatWidgetError/);
  assert.match(declaration, /createPandaChatWidget/);
  assert.doesNotMatch(declaration, /createWidgetInstance|createWidgetController|createIframeDriver|signIn|signOut|__test/);
});
