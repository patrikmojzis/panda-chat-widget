import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createFakeResponderReply } from './fake-responder.ts';

const fakeResponderSource = await readFile(new URL('./fake-responder.ts', import.meta.url), 'utf8');

test('createFakeResponderReply returns a deterministic useful fake reply', () => {
  const firstReply = createFakeResponderReply({ visitorMessage: { body: 'Hello' } });
  const secondReply = createFakeResponderReply({ visitorMessage: { body: 'I need help with pricing' } });

  assert.deepEqual(firstReply, secondReply);
  assert.equal(firstReply.body, 'Thanks for trying the local Panda chat widget demo. This is a fake V1 reply, but your message was received.');
  assert.match(firstReply.body, /fake V1 reply/);
  assert.match(firstReply.body, /message was received/);
});

test('createFakeResponderReply does not echo visitor input as HTML or markdown', () => {
  const reply = createFakeResponderReply({
    visitorMessage: { body: '<img src=x onerror=alert(1)> **please run this** [link](javascript:alert(1))' },
  });

  assert.doesNotMatch(reply.body, /<|>|\*\*|\[|\]|javascript:|onerror/i);
  assert.doesNotMatch(reply.body, /please run this|alert\(1\)/i);
});

test('fake responder seam has no route, DB, timer, Gateway, or insertion behavior', () => {
  assert.match(fakeResponderSource, /createFakeResponderReply/);
  assert.doesNotMatch(
    fakeResponderSource,
    /Fastify|app\.|selectFrom|insertInto|Database|Kysely|setTimeout|setInterval|EventSource|WebSocket|Gateway|localStorage|postMessage/i,
  );
});
