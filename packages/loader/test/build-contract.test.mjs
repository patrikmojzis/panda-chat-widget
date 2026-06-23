import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const buildConfig = JSON.parse(await readFile(new URL('../tsconfig.build.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../src/panda-chat-widget-loader.ts', import.meta.url), 'utf8');

test('loader package builds one browser script artifact from the TypeScript entry', () => {
  assert.equal(packageJson.browser, 'dist/panda-chat-widget-loader.js');
  assert.equal(packageJson.main, 'dist/panda-chat-widget-loader.js');
  assert.equal(packageJson.scripts.build, 'tsc -p tsconfig.build.json');
  assert.deepEqual(buildConfig.include, ['src/panda-chat-widget-loader.ts']);
  assert.equal(buildConfig.compilerOptions.rootDir, './src');
  assert.equal(buildConfig.compilerOptions.outDir, './dist');
});

test('loader entry is a passive browser global marker only', () => {
  assert.match(source, /window as LoaderWindow/);
  assert.match(source, /PandaChatWidgetLoader/);
  assert.doesNotMatch(source, /document\.createElement|appendChild|dataset|getAttribute|iframe|fetch\(/);
});
