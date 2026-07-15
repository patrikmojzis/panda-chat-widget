import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakeClock } from './helpers/fake-clock.mjs';
import { createFakeDocument, findIframe } from './helpers/fake-dom.mjs';

const { createIframeDriver } = await import('../../../.cache/loader-test-core/core-harness.js');

function mountDriver() {
  const clock = createFakeClock();
  const document = createFakeDocument();
  const events = [];
  const driver = createIframeDriver(clock);
  driver.mount(document, 'public-key', 'https://widget.example', true, {
    onReady() { events.push('ready'); },
    onError() { events.push('error'); },
    onVisibilityIntent(open) { events.push(`visibility:${open}`); },
  });
  return { clock, document, driver, events, iframe: findIframe(document) };
}

test('iframe timeout fails at exactly 10,000ms and cleans every resource', () => {
  const { clock, document, events } = mountDriver();
  assert.equal(clock.pendingCount, 1);
  clock.advance(9_999);
  assert.deepEqual(events, []);
  assert.ok(document.getElementById('panda-chat-widget-launcher'));
  clock.advance(1);
  assert.deepEqual(events, ['error']);
  assert.equal(clock.pendingCount, 0);
  assert.equal(document.getElementById('panda-chat-widget-launcher'), null);
  assert.equal(document.getElementById('panda-chat-widget-loader-styles'), null);
  assert.equal(document.body.countListeners() + document.head.countListeners(), 0);
});

test('iframe ready cancels timeout and ignores later terminal events', () => {
  const { clock, driver, events, iframe } = mountDriver();
  iframe.fireLoad();
  assert.deepEqual(events, ['ready']);
  assert.equal(clock.pendingCount, 0);
  iframe.fireError();
  clock.advance(10_000);
  assert.deepEqual(events, ['ready']);
  driver.destroy();
  assert.equal(clock.pendingCount, 0);
});

test('iframe error and destroy cancel timeout without residual listeners', () => {
  const failed = mountDriver();
  failed.iframe.fireError();
  assert.deepEqual(failed.events, ['error']);
  assert.equal(failed.clock.pendingCount, 0);
  assert.equal(failed.document.body.countListeners() + failed.document.head.countListeners(), 0);

  const destroyed = mountDriver();
  destroyed.driver.destroy();
  assert.deepEqual(destroyed.events, []);
  assert.equal(destroyed.clock.pendingCount, 0);
  assert.equal(destroyed.document.body.countListeners() + destroyed.document.head.countListeners(), 0);
});
