import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const widgetHtml = await readFile(new URL('../widget.html', import.meta.url), 'utf8');
const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');

test('basic HTML demo builds and serves the copied loader artifact', () => {
  assert.equal(packageJson.scripts.dev, 'python3 -m http.server 4173 --bind 127.0.0.1 --directory .');
  assert.equal(
    packageJson.scripts.build,
    'pnpm --filter @panda-chat-widget/loader build && mkdir -p vendor && cp ../../packages/loader/dist/panda-chat-widget-loader.js vendor/panda-chat-widget-loader.js',
  );
  assert.equal(packageJson.scripts.test, 'node --test "test/**/*.test.mjs"');
  assert.match(gitignore, /^\/vendor\/$/m);
});

test('basic HTML demo loads the loader with the stable demo widget key', () => {
  assert.match(indexHtml, /\.\/vendor\/panda-chat-widget-loader\.js/);
  assert.match(indexHtml, /data-site-key="demo-local-widget"/);
  assert.match(indexHtml, /bottom-right launcher/);
  assert.doesNotMatch(indexHtml, /fetch\(|XMLHttpRequest|postMessage|innerHTML/);
});

test('basic HTML demo includes a static iframe placeholder only', () => {
  assert.match(widgetHtml, /Widget iframe placeholder/);
  assert.match(widgetHtml, /publicKey/);
  assert.doesNotMatch(widgetHtml, /fetch\(|XMLHttpRequest|postMessage|innerHTML|React/);
});
