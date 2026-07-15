import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createFakeClock } from './helpers/fake-clock.mjs';
import { createFakeDocument, createScript, findIframe } from './helpers/fake-dom.mjs';

const classicSource = await readFile(new URL('../dist/panda-chat-widget-loader.js', import.meta.url), 'utf8');

function createClassicRealm({ origin = 'https://host.example', config } = {}) {
  const clock = createFakeClock();
  const document = createFakeDocument(origin);
  const window = {
    URL,
    clearTimeout: clock.clearTimeout,
    console,
    document,
    location: { href: `${origin}/support/page`, origin },
    setTimeout: clock.setTimeout,
  };
  window.window = window;
  if (config !== undefined) window.PandaChatWidgetConfig = config;
  const context = vm.createContext(window);

  function execute(attributes = {}, nextConfig = config) {
    document.currentScript = createScript(attributes);
    if (nextConfig === undefined) delete window.PandaChatWidgetConfig;
    else window.PandaChatWidgetConfig = nextConfig;
    vm.runInContext(classicSource, context, { timeout: 5_000 });
    return window.PandaChatWidget;
  }

  return { clock, context, document, execute, window };
}

function rejection(promise) {
  return promise.then(
    () => assert.fail('expected rejection'),
    (error) => error,
  );
}

test('classic loader preserves key aliases, metadata, and public inventory', () => {
  const realm = createClassicRealm();
  const widget = realm.execute({ 'data-site-key': ' demo-key ' });
  assert.deepEqual(JSON.parse(JSON.stringify(realm.window.PandaChatWidgetLoader)), {
    version: '0.0.0',
    config: { status: 'configured', publicKey: 'demo-key' },
  });
  assert.ok(Object.isFrozen(realm.window.PandaChatWidgetLoader));
  assert.ok(Object.isFrozen(realm.window.PandaChatWidgetLoader.config));
  assert.deepEqual(Object.keys(widget).sort(), [
    'close', 'create', 'destroy', 'getState', 'init', 'open', 'subscribe', 'toggle',
  ]);
  assert.equal(widget.signIn, undefined);
  assert.equal(widget.signOut, undefined);
});

test('built classic resolves every script and global key alias', () => {
  const cases = [
    { name: 'script public', attributes: { 'data-public-key': 'script-public' }, expected: 'script-public' },
    { name: 'script widget', attributes: { 'data-widget-key': 'script-widget' }, expected: 'script-widget' },
    { name: 'script site', attributes: { 'data-site-key': 'script-site' }, expected: 'script-site' },
    { name: 'global public', config: { publicKey: 'global-public' }, expected: 'global-public' },
    { name: 'global widget', config: { widgetKey: 'global-widget' }, expected: 'global-widget' },
    { name: 'global site', config: { siteKey: 'global-site' }, expected: 'global-site' },
  ];

  for (const row of cases) {
    const realm = createClassicRealm({ config: row.config });
    const widget = realm.execute(row.attributes, row.config);
    assert.equal(realm.window.PandaChatWidgetLoader.config.publicKey, row.expected, row.name);
    assert.equal(new URL(findIframe(realm.document).attributes.src).searchParams.get('publicKey'), row.expected, row.name);
    widget.destroy();
  }
});

test('built classic honors launcher true and false', () => {
  for (const [value, expectedButtons] of [['true', 1], ['false', 0]]) {
    const realm = createClassicRealm();
    const widget = realm.execute({ 'data-public-key': `launcher-${value}`, 'data-launcher': value });
    const container = realm.document.getElementById('panda-chat-widget-launcher');
    const buttons = container.children.filter((child) => child.className === 'panda-chat-widget-launcher-button');
    assert.equal(buttons.length, expectedButtons, `launcher=${value}`);
    widget.destroy();
  }
});

test('built classic resolves default and explicit base URLs', () => {
  const cases = [
    {
      name: 'default',
      origin: 'https://host.example',
      attributes: { 'data-public-key': 'default-base' },
      expected: 'https://host.example/widget.html',
    },
    {
      name: 'explicit',
      origin: 'https://host.example',
      attributes: { 'data-public-key': 'explicit-base', 'data-base-url': 'https://widget.example/sub/' },
      expected: 'https://widget.example/sub/widget.html',
    },
  ];

  for (const row of cases) {
    const realm = createClassicRealm({ origin: row.origin });
    const widget = realm.execute(row.attributes);
    const iframeUrl = new URL(findIframe(realm.document).attributes.src);
    assert.equal(`${iframeUrl.origin}${iframeUrl.pathname}`, row.expected, row.name);
    widget.destroy();
  }
});

test('classic loader uses script fields over global config and mounts encoded iframe URL', () => {
  const realm = createClassicRealm({ config: { publicKey: 'global', baseUrl: 'https://global.invalid' } });
  realm.execute({
    'data-public-key': 'script key/with?chars',
    'data-base-url': 'https://widget.example/sub/',
  });
  const iframeUrl = new URL(findIframe(realm.document).attributes.src);
  assert.equal(iframeUrl.origin, 'https://widget.example');
  assert.equal(iframeUrl.pathname, '/sub/widget.html');
  assert.equal(iframeUrl.searchParams.get('publicKey'), 'script key/with?chars');
});

test('classic loader reports missing and invalid first-load config safely', () => {
  const missing = createClassicRealm();
  const missingWidget = missing.execute({ 'data-site-key': '   ' });
  assert.equal(missing.window.PandaChatWidgetLoader.config.status, 'missing_key');
  assert.equal(missingWidget.getState().error.code, 'MISSING_PUBLIC_KEY');
  assert.equal(missing.document.getElementById('panda-chat-widget-launcher'), null);

  const invalid = createClassicRealm();
  const invalidWidget = invalid.execute({ 'data-public-key': 'key', 'data-launcher': 'wat' });
  assert.equal(invalidWidget.getState().error.code, 'INVALID_OPTIONS');
  assert.equal(invalid.document.getElementById('panda-chat-widget-launcher'), null);
});

test('same-realm conflicting duplicate before load preserves owner and persistent diagnostic', async () => {
  const realm = createClassicRealm();
  const widget = realm.execute({ 'data-public-key': 'first' });
  const loader = realm.window.PandaChatWidgetLoader;
  const firstPromise = widget.init({ publicKey: 'first' });
  const snapshots = [];
  widget.subscribe((state) => snapshots.push(state));
  const beforeConflictCount = snapshots.length;

  const duplicateWidget = realm.execute({ 'data-public-key': 'second' });
  assert.equal(duplicateWidget, widget);
  assert.equal(realm.window.PandaChatWidgetLoader, loader);
  assert.equal(realm.document.body.children.length, 1);
  assert.equal(realm.clock.pendingCount, 1);
  assert.equal(widget.getState().lifecycle, 'initializing');
  assert.equal(widget.getState().error.code, 'INIT_OPTIONS_CONFLICT');
  assert.equal(snapshots.length, beforeConflictCount + 1);

  realm.execute({ 'data-public-key': 'second' });
  assert.equal(snapshots.length, beforeConflictCount + 1, 'same diagnostic is not republished');
  realm.execute({ 'data-public-key': 'first' });
  assert.equal(snapshots.length, beforeConflictCount + 1, 'same normalized options are a no-op');

  findIframe(realm.document).fireLoad();
  const ready = await firstPromise;
  assert.equal(ready, widget.getState());
  assert.equal(ready.lifecycle, 'ready');
  assert.equal(ready.error.code, 'INIT_OPTIONS_CONFLICT');
  assert.equal(realm.clock.pendingCount, 0);
  widget.open();
  assert.equal(widget.getState().error.code, 'INIT_OPTIONS_CONFLICT');

  const other = widget.create();
  assert.equal((await rejection(other.init({ publicKey: 'other' }))).code, 'INSTANCE_CONFLICT');
  assert.equal(realm.document.body.children.length, 1);
  widget.destroy();
});

test('same-realm malformed duplicate before load uses classic conflict channel', () => {
  const realm = createClassicRealm();
  const widget = realm.execute({ 'data-public-key': 'first' });
  realm.execute({ 'data-public-key': 'second', 'data-launcher': 'wat' });
  assert.equal(widget.getState().lifecycle, 'initializing');
  assert.equal(widget.getState().error.code, 'INIT_OPTIONS_CONFLICT');
  assert.equal(realm.clock.pendingCount, 1);
  assert.equal(realm.document.body.children.length, 1);
});

test('same-realm conflicting duplicate after load stays ready and keeps first resources', async () => {
  const realm = createClassicRealm();
  const widget = realm.execute({ 'data-public-key': 'first' });
  const loader = realm.window.PandaChatWidgetLoader;
  const firstPromise = widget.init({ publicKey: 'first' });
  findIframe(realm.document).fireLoad();
  await firstPromise;
  const snapshots = [];
  widget.subscribe((state) => snapshots.push(state));

  realm.execute({ 'data-public-key': 'second' });
  assert.equal(realm.window.PandaChatWidget, widget);
  assert.equal(realm.window.PandaChatWidgetLoader, loader);
  assert.equal(widget.getState().lifecycle, 'ready');
  assert.equal(widget.getState().error.code, 'INIT_OPTIONS_CONFLICT');
  assert.equal(realm.clock.pendingCount, 0);
  assert.equal(realm.document.body.children.length, 1);
  assert.equal(snapshots.length, 2);

  realm.execute({ 'data-public-key': 'third', 'data-launcher': 'wat' });
  assert.equal(snapshots.length, 2);
  widget.close();
  assert.equal(widget.getState().error.code, 'INIT_OPTIONS_CONFLICT');
  widget.destroy();
  assert.equal(Object.hasOwn(widget.getState(), 'error'), false);

  const nextPromise = widget.init({ publicKey: 'new-generation' });
  assert.equal(Object.hasOwn(widget.getState(), 'error'), false);
  findIframe(realm.document).fireLoad();
  const nextReady = await nextPromise;
  assert.equal(Object.hasOwn(nextReady, 'error'), false);
  widget.destroy();
});

test('classic built artifact remains a standalone IIFE without prohibited APIs', () => {
  assert.doesNotMatch(classicSource, /^import\s/m);
  assert.doesNotMatch(classicSource, /^export\s/m);
  assert.doesNotMatch(classicSource, /postMessage/);
  assert.doesNotMatch(classicSource, /signIn|signOut/);
});
