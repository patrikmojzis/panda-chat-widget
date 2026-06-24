import assert from 'node:assert/strict';
import test from 'node:test';

import { allowAllPublicWriteRateLimit, toRateLimitErrorResponse } from './rate-limit.ts';

test('default public write rate-limit hook allows dev/demo requests', async () => {
  assert.deepEqual(await allowAllPublicWriteRateLimit({
    route: 'message_create',
    publicKey: 'demo-local-widget',
    visitorSessionId: 'visitor-session-1',
    conversationId: 'conversation-1',
    clientMessageId: 'client-message-1',
  }), { allowed: true });
});

test('rate-limit rejection response shape is stable', () => {
  assert.deepEqual(toRateLimitErrorResponse({ allowed: false, reason: 'too_many_requests' }), {
    error: 'rate_limited',
    reason: 'too_many_requests',
  });
});
