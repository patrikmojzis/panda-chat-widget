import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as ts from 'typescript';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const buildConfig = JSON.parse(await readFile(new URL('../tsconfig.build.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../src/panda-chat-widget-loader.ts', import.meta.url), 'utf8');
const compiledLoader = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.None,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

function runLoader({ attributes = {}, initConfig } = {}) {
  const windowObject = {};

  if (initConfig !== undefined) {
    windowObject.PandaChatWidgetConfig = initConfig;
  }

  const currentScript = {
    getAttribute: (name) => (Object.hasOwn(attributes, name) ? attributes[name] : null),
  };

  vm.runInNewContext(
    compiledLoader,
    {
      document: { currentScript },
      window: windowObject,
    },
    { timeout: 1000 },
  );

  return JSON.parse(JSON.stringify(windowObject.PandaChatWidgetLoader));
}

test('loader package builds one browser script artifact from the TypeScript entry', () => {
  assert.equal(packageJson.browser, 'dist/panda-chat-widget-loader.js');
  assert.equal(packageJson.main, 'dist/panda-chat-widget-loader.js');
  assert.equal(packageJson.scripts.build, 'tsc -p tsconfig.build.json');
  assert.deepEqual(buildConfig.include, ['src/panda-chat-widget-loader.ts']);
  assert.equal(buildConfig.compilerOptions.rootDir, './src');
  assert.equal(buildConfig.compilerOptions.outDir, './dist');
});

test('loader entry reads config without creating UI or network behavior', () => {
  assert.match(source, /resolveLoaderConfig/);
  assert.match(source, /data-site-key/);
  assert.match(source, /data-public-key/);
  assert.match(source, /data-widget-key/);
  assert.match(source, /PandaChatWidgetConfig/);
  assert.match(source, /PandaChatWidgetLoader/);
  assert.doesNotMatch(source, /document\.createElement|appendChild|iframe|fetch\(/);
});

test('loader resolves a site key from current script data attributes', () => {
  const loader = runLoader({ attributes: { 'data-site-key': ' demo-local-widget ' } });

  assert.deepEqual(loader, {
    version: '0.0.0',
    config: { status: 'configured', publicKey: 'demo-local-widget' },
  });
});

test('loader resolves a public key from tiny init config when script attributes are absent', () => {
  const loader = runLoader({ initConfig: { publicKey: ' init-widget-key ' } });

  assert.deepEqual(loader, {
    version: '0.0.0',
    config: { status: 'configured', publicKey: 'init-widget-key' },
  });
});

test('loader represents a missing key without throwing on the host page', () => {
  const loader = runLoader({ attributes: { 'data-site-key': '   ' } });

  assert.deepEqual(loader, {
    version: '0.0.0',
    config: { status: 'missing_key' },
  });
});
