import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createFakeClock } from './helpers/fake-clock.mjs';
import { createFakeDocument, createScript, findIframe } from './helpers/fake-dom.mjs';

const leaseKey = Symbol.for('__panda_chat_widget_lease__');
const defaultKey = Symbol.for('__panda_chat_widget_default__');
const touchedGlobals = ['document', 'window', 'setTimeout', 'clearTimeout', 'PandaChatWidgetLoader', leaseKey, defaultKey];

function captureProperty(target, key) {
  return { present: Object.hasOwn(target, key), value: target[key] };
}

function restoreProperty(target, key, snapshot) {
  if (snapshot.present) target[key] = snapshot.value;
  else delete target[key];
}

function captureTouchedGlobals() {
  return new Map(touchedGlobals.map((key) => [key, captureProperty(globalThis, key)]));
}

function restoreTouchedGlobals(snapshots) {
  for (const [key, snapshot] of snapshots) restoreProperty(globalThis, key, snapshot);
}

function assertTouchedGlobals(snapshots) {
  for (const [key, snapshot] of snapshots) {
    assert.equal(Object.hasOwn(globalThis, key), snapshot.present, `presence for ${String(key)}`);
    if (snapshot.present) assert.equal(globalThis[key], snapshot.value, `value for ${String(key)}`);
  }
}

const leaseBeforeImport = captureProperty(globalThis, leaseKey);
const esm = await import(`../dist/index.js?fresh=${Date.now()}`);
const classicSource = await readFile(new URL('../dist/panda-chat-widget-loader.js', import.meta.url), 'utf8');

async function exerciseSameRealmLeaseContention() {
  const globalsBefore = captureTouchedGlobals();
  const clock = createFakeClock();
  const document = createFakeDocument('https://shared.example');
  const window = { location: { href: 'https://shared.example/page', origin: 'https://shared.example' } };
  const promises = [];
  let esmWidget;
  let classicWidget;

  window.window = window;
  document.currentScript = createScript({ 'data-public-key': 'classic-owner' });

  try {
    delete globalThis[defaultKey];
    delete globalThis[leaseKey];
    delete globalThis.PandaChatWidgetLoader;
    globalThis.document = document;
    globalThis.window = window;
    globalThis.setTimeout = clock.setTimeout;
    globalThis.clearTimeout = clock.clearTimeout;

    esmWidget = esm.createPandaChatWidget();
    const esmPromise = esmWidget.init({ publicKey: 'esm-owner' });
    promises.push(esmPromise);
    vm.runInThisContext(classicSource, { timeout: 5_000 });
    classicWidget = window.PandaChatWidget;

    assert.equal(classicWidget.getState().lifecycle, 'error');
    assert.equal(classicWidget.getState().error.code, 'INSTANCE_CONFLICT');
    assert.equal(document.body.children.length, 1);
    assert.equal(clock.pendingCount, 1);

    esmWidget.destroy();
    await Promise.allSettled([esmPromise]);
    assert.equal(document.body.children.length, 0);
    assert.equal(clock.pendingCount, 0);

    const classicPromise = classicWidget.init({ publicKey: 'classic-owner' });
    promises.push(classicPromise);
    assert.equal(document.body.children.length, 1);
    findIframe(document).fireLoad();
    assert.equal((await classicPromise).lifecycle, 'ready');
    classicWidget.destroy();
    assert.equal(document.body.children.length, 0);
    assert.equal(clock.pendingCount, 0);
  } finally {
    classicWidget?.destroy();
    esmWidget?.destroy();
    await Promise.allSettled(promises);
    restoreTouchedGlobals(globalsBefore);
  }
}

test('built ESM import is side-effect-free with exact exports and methods', () => {
  assert.equal(Object.hasOwn(globalThis, leaseKey), leaseBeforeImport.present);
  if (leaseBeforeImport.present) assert.equal(globalThis[leaseKey], leaseBeforeImport.value);
  assert.deepEqual(Object.keys(esm).sort(), ['PandaChatWidgetError', 'createPandaChatWidget']);
  const widget = esm.createPandaChatWidget();
  try {
    assert.deepEqual(Object.keys(widget).sort(), [
      'close', 'destroy', 'getState', 'init', 'open', 'subscribe', 'toggle',
    ]);
    assert.deepEqual(widget.getState(), {
      lifecycle: 'idle',
      visibility: 'closed',
      auth: 'anonymous',
    });
    assert.ok(Object.isFrozen(widget.getState()));
  } finally {
    widget.destroy();
  }
});

test('built ESM init resolves with the exact committed immutable ready snapshot', async () => {
  const documentBefore = captureProperty(globalThis, 'document');
  const document = createFakeDocument('https://host.example');
  const widget = esm.createPandaChatWidget();
  let promise;

  globalThis.document = document;
  try {
    promise = widget.init({ publicKey: 'public-key' });
    const initializing = widget.getState();
    assert.equal(initializing.lifecycle, 'initializing');
    assert.equal(Object.hasOwn(initializing, 'error'), false);
    findIframe(document).fireLoad();
    const ready = await promise;
    assert.equal(ready, widget.getState());
    assert.deepEqual(ready, {
      lifecycle: 'ready',
      visibility: 'closed',
      auth: 'anonymous',
    });
    assert.ok(Object.isFrozen(ready));
  } finally {
    widget.destroy();
    await Promise.allSettled(promise ? [promise] : []);
    restoreProperty(globalThis, 'document', documentBefore);
  }
});

test('built ESM supports simultaneous generations in separate documents', async () => {
  const documentBefore = captureProperty(globalThis, 'document');
  const firstDocument = createFakeDocument('https://first.example');
  const secondDocument = createFakeDocument('https://second.example');
  const firstWidget = esm.createPandaChatWidget();
  const secondWidget = esm.createPandaChatWidget();
  const promises = [];

  try {
    globalThis.document = firstDocument;
    const firstPromise = firstWidget.init({ publicKey: 'first' });
    promises.push(firstPromise);
    globalThis.document = secondDocument;
    const secondPromise = secondWidget.init({ publicKey: 'second' });
    promises.push(secondPromise);

    findIframe(firstDocument).fireLoad();
    findIframe(secondDocument).fireLoad();
    assert.equal((await firstPromise).lifecycle, 'ready');
    assert.equal((await secondPromise).lifecycle, 'ready');
    assert.ok(firstDocument.getElementById('panda-chat-widget-launcher'));
    assert.ok(secondDocument.getElementById('panda-chat-widget-launcher'));
  } finally {
    firstWidget.destroy();
    secondWidget.destroy();
    await Promise.allSettled(promises);
    restoreProperty(globalThis, 'document', documentBefore);
  }

  assert.equal(firstDocument.getElementById('panda-chat-widget-launcher'), null);
  assert.equal(secondDocument.getElementById('panda-chat-widget-launcher'), null);
});

test('built classic and ESM contend for and release one same-realm document lease', async () => {
  await exerciseSameRealmLeaseContention();
});

test('same-realm lease proof restores every pre-existing global sentinel', async () => {
  const globalsBefore = captureTouchedGlobals();
  const sentinels = new Map(touchedGlobals.map((key) => [key, { key: String(key) }]));

  try {
    for (const [key, sentinel] of sentinels) globalThis[key] = sentinel;
    const sentinelSnapshots = captureTouchedGlobals();
    await exerciseSameRealmLeaseContention();
    assertTouchedGlobals(sentinelSnapshots);
  } finally {
    restoreTouchedGlobals(globalsBefore);
  }
});

test('built error JSON is a detached exact four-key safe object', async () => {
  const widget = esm.createPandaChatWidget();
  try {
    const error = await widget.init({ publicKey: '' }).catch((caught) => caught);
    assert.ok(error instanceof esm.PandaChatWidgetError);
    error.code = 'MUTATED';
    error.message = 'private https://secret.invalid';
    const json = error.toJSON();
    assert.deepEqual(json, {
      scope: 'init',
      code: 'MISSING_PUBLIC_KEY',
      recoverable: true,
      message: 'A non-empty publicKey is required.',
    });
    assert.deepEqual(Object.keys(json).sort(), ['code', 'message', 'recoverable', 'scope']);
    assert.doesNotMatch(JSON.stringify(json), /secret|private|stack|https?:/i);
    assert.equal(widget.getState().error.code, 'MISSING_PUBLIC_KEY');
    assert.ok(Object.isFrozen(widget.getState().error));
  } finally {
    widget.destroy();
  }
});
