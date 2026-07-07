import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import type { LocalPandaDispatchPayloadV1 } from './local-panda-dispatch-payload.ts';
import {
  buildLocalPandaReplyIngressPayloadV1,
  type BuildLocalPandaReplyIngressPayloadV1Input,
  type LocalPandaReplyIngressCorrelationIds,
} from './local-panda-reply-ingress-payload.ts';

const replyIngressSource = await readFile(new URL('./local-panda-reply-ingress-payload.ts', import.meta.url), 'utf8');
const appSource = await readFile(new URL('./app.ts', import.meta.url), 'utf8');
const dryRunSource = await readFile(new URL('./local-panda-dispatch-dry-run.ts', import.meta.url), 'utf8');
const dryRunCliSource = await readFile(new URL('./local-panda-dispatch-dry-run-cli.ts', import.meta.url), 'utf8');
const fakeResponderSource = await readFile(new URL('./fake-responder.ts', import.meta.url), 'utf8');
const consoleSource = await readSourceTree(new URL('../../console/src/', import.meta.url));
const widgetUiSource = await readSourceTree(new URL('../../widget-ui/src/', import.meta.url));

const baseCorrelationIds: LocalPandaReplyIngressCorrelationIds = {
  intentId: 'intent-1',
  widgetId: 'widget-1',
  conversationId: 'conversation-1',
  visitorSessionId: 'visitor-session-1',
  visitorMessageId: 'visitor-message-1',
  clientMessageId: 'client-message-1',
};

test('buildLocalPandaReplyIngressPayloadV1 builds the exact local-only v1 reply ingress payload', () => {
  const result = buildLocalPandaReplyIngressPayloadV1({
    dispatchPayload: {
      ...validDispatchPayload(),
      metadata: {
        ...validDispatchPayload().metadata,
        model: 'should-not-pass-through',
      },
    } as LocalPandaDispatchPayloadV1,
    reply: {
      ...replyFor(validDispatchPayload(), '  Hello from the local Panda agent.  '),
      metadata: {
        network: 'should-not-pass-through',
        candidate: 'should-not-pass-through',
      },
    } as BuildLocalPandaReplyIngressPayloadV1Input['reply'],
  });

  assert.deepEqual(result, {
    built: true,
    payload: {
      version: 1,
      kind: 'local-panda-reply-ingress',
      idempotencyKey: 'local-panda-reply-v1:intent-1',
      correlationIds: {
        intentId: 'intent-1',
        widgetId: 'widget-1',
        conversationId: 'conversation-1',
        visitorSessionId: 'visitor-session-1',
        visitorMessageId: 'visitor-message-1',
        clientMessageId: 'client-message-1',
      },
      reply: {
        body: 'Hello from the local Panda agent.',
        text: 'Hello from the local Panda agent.',
      },
      metadata: {
        locality: 'local-only',
        ingress: 'future-reply',
        contract: 'contract-only',
        network: 'no-network',
        stateMutation: 'no-state-mutation',
        replyInsertion: 'no-reply-insertion',
        replyCardinality: 'one-reply-per-claimed-intent-v1',
      },
    },
  });
});

test('buildLocalPandaReplyIngressPayloadV1 refuses invalid dispatch envelopes before reply idempotency', () => {
  const cases: Array<{
    name: string;
    dispatchPayload: unknown;
  }> = [
    {
      name: 'invalid version',
      dispatchPayload: { ...validDispatchPayload(), version: 2 },
    },
    {
      name: 'invalid kind',
      dispatchPayload: { ...validDispatchPayload(), kind: 'local-panda-reply-ingress' },
    },
    {
      name: 'unclaimed intent',
      dispatchPayload: {
        ...validDispatchPayload(),
        intent: { ...validDispatchPayload().intent, status: 'queued' },
      },
    },
    {
      name: 'missing claimedAt',
      dispatchPayload: {
        ...validDispatchPayload(),
        intent: { ...validDispatchPayload().intent, claimedAt: '   ' },
      },
    },
    {
      name: 'blank dispatch correlation ID',
      dispatchPayload: validDispatchPayload({ intentId: '   ' }),
    },
    {
      name: 'nested intent ID mismatch',
      dispatchPayload: {
        ...validDispatchPayload(),
        intent: { ...validDispatchPayload().intent, id: 'other-intent' },
      },
    },
    {
      name: 'nested widget ID mismatch',
      dispatchPayload: {
        ...validDispatchPayload(),
        widget: { id: 'other-widget' },
      },
    },
    {
      name: 'nested conversation ID mismatch',
      dispatchPayload: {
        ...validDispatchPayload(),
        conversation: { id: 'other-conversation' },
      },
    },
    {
      name: 'nested visitor session ID mismatch',
      dispatchPayload: {
        ...validDispatchPayload(),
        visitorSession: { id: 'other-session' },
      },
    },
    {
      name: 'nested visitor message ID mismatch',
      dispatchPayload: {
        ...validDispatchPayload(),
        visitorMessage: { ...validDispatchPayload().visitorMessage, id: 'other-message' },
      },
    },
    {
      name: 'nested client message ID mismatch',
      dispatchPayload: {
        ...validDispatchPayload(),
        visitorMessage: { ...validDispatchPayload().visitorMessage, clientMessageId: 'other-client-message' },
      },
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      buildLocalPandaReplyIngressPayloadV1({
        dispatchPayload: testCase.dispatchPayload as LocalPandaDispatchPayloadV1,
        reply: replyFor(validDispatchPayload(), 'Reply text'),
      }),
      { built: false, reason: 'invalid_dispatch_payload' },
      testCase.name,
    );
  }
});

test('buildLocalPandaReplyIngressPayloadV1 validates reply correlation shape before matching', () => {
  const cases: Array<{
    name: string;
    reply: unknown;
  }> = [
    {
      name: 'missing correlation IDs',
      reply: { text: 'Reply text' },
    },
    {
      name: 'blank correlation ID',
      reply: {
        correlationIds: correlationIds({ visitorMessageId: '   ' }),
        text: 'Reply text',
      },
    },
    {
      name: 'non-string correlation ID',
      reply: {
        correlationIds: { ...correlationIds(), clientMessageId: 123 },
        text: 'Reply text',
      },
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      buildLocalPandaReplyIngressPayloadV1({
        dispatchPayload: validDispatchPayload(),
        reply: testCase.reply as BuildLocalPandaReplyIngressPayloadV1Input['reply'],
      }),
      { built: false, reason: 'invalid_reply_correlation' },
      testCase.name,
    );
  }
});

test('buildLocalPandaReplyIngressPayloadV1 refuses reply correlation mismatches', () => {
  assert.deepEqual(
    buildLocalPandaReplyIngressPayloadV1({
      dispatchPayload: validDispatchPayload(),
      reply: {
        correlationIds: correlationIds({ clientMessageId: 'other-client-message' }),
        text: 'Reply text',
      },
    }),
    { built: false, reason: 'reply_correlation_mismatch' },
  );
});

test('buildLocalPandaReplyIngressPayloadV1 validates reply text from one normalized source of truth', () => {
  const cases: Array<{
    name: string;
    reply: unknown;
    reason: 'missing_reply_text' | 'invalid_reply_text';
  }> = [
    {
      name: 'missing text',
      reply: { correlationIds: correlationIds() },
      reason: 'missing_reply_text',
    },
    {
      name: 'blank text',
      reply: { correlationIds: correlationIds(), text: '   ' },
      reason: 'missing_reply_text',
    },
    {
      name: 'non-string text',
      reply: { correlationIds: correlationIds(), text: 123 },
      reason: 'invalid_reply_text',
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      buildLocalPandaReplyIngressPayloadV1({
        dispatchPayload: validDispatchPayload(),
        reply: testCase.reply as BuildLocalPandaReplyIngressPayloadV1Input['reply'],
      }),
      { built: false, reason: testCase.reason },
      testCase.name,
    );
  }
});

test('buildLocalPandaReplyIngressPayloadV1 idempotency is one reply per claimed intent in v1', () => {
  const baseDispatchPayload = validDispatchPayload();
  const changedDispatchPayload = validDispatchPayload(
    {},
    {
      idempotencyKey: 'local-panda-dispatch-v1:changed-dispatch-key',
      routeHandleSnapshot: 'panda:workspace/changed-route',
      intent: {
        ...baseDispatchPayload.intent,
        createdAt: '2026-01-01T00:01:00.000Z',
        claimedAt: '2026-01-01T00:11:00.000Z',
      },
      visitorMessage: {
        ...baseDispatchPayload.visitorMessage,
        body: 'Edited visitor message',
        text: 'Edited visitor message',
        createdAt: '2026-01-01T00:06:00.000Z',
      },
    },
  );
  const first = buildLocalPandaReplyIngressPayloadV1({
    dispatchPayload: baseDispatchPayload,
    reply: replyFor(baseDispatchPayload, 'First reply text'),
  });
  const changedReplyAndDispatchContext = buildLocalPandaReplyIngressPayloadV1({
    dispatchPayload: changedDispatchPayload,
    reply: replyFor(changedDispatchPayload, 'Changed reply text'),
  });
  const differentIntentDispatchPayload = validDispatchPayload({ intentId: 'intent-2' });
  const differentIntent = buildLocalPandaReplyIngressPayloadV1({
    dispatchPayload: differentIntentDispatchPayload,
    reply: replyFor(differentIntentDispatchPayload, 'First reply text'),
  });

  if (!first.built || !changedReplyAndDispatchContext.built || !differentIntent.built) {
    assert.fail('expected all idempotency payloads to be validly built');
  }

  assert.equal(first.payload.idempotencyKey, changedReplyAndDispatchContext.payload.idempotencyKey);
  assert.equal(first.payload.idempotencyKey, 'local-panda-reply-v1:intent-1');
  assert.notEqual(first.payload.idempotencyKey, differentIntent.payload.idempotencyKey);
  assert.equal(differentIntent.payload.idempotencyKey, 'local-panda-reply-v1:intent-2');
  assert.equal(first.payload.metadata.replyCardinality, 'one-reply-per-claimed-intent-v1');
});

test('local Panda reply ingress payload helper has no storage, public route, network, worker, or insertion behavior', () => {
  assert.match(replyIngressSource, /buildLocalPandaReplyIngressPayloadV1/);
  assert.match(replyIngressSource, /import type \{ LocalPandaDispatchPayloadV1 \}/);
  assert.doesNotMatch(
    replyIngressSource,
    /from ['"]\.\/db\.ts|selectFrom|insertInto|updateTable|deleteFrom|transaction\(|Kysely|DatabaseExecutor|DatabaseClient/i,
  );
  assert.doesNotMatch(replyIngressSource, /Fastify|app\.|Route\.resource|routeHandle|route\s*:/i);
  assert.doesNotMatch(
    replyIngressSource,
    /fetch\s*\(|WebSocket|EventSource|node:http|node:https|Gateway|node:child_process|child_process|spawn\s*\(|exec\s*\(|setTimeout\s*\(|setInterval\s*\(|Worker\s*\(|dispatcher|daemon|retry|dead-letter|status:\s*'sent'|status:\s*'delivered'|status:\s*'failed'|reply-ingestion/i,
  );
});

test('local Panda reply ingress payload contract is not wired into public routes, frontends, dry run, or fake responder', () => {
  const publicAndExistingLocalSources = [
    appSource,
    dryRunSource,
    dryRunCliSource,
    fakeResponderSource,
    consoleSource,
    widgetUiSource,
  ].join('\n');

  assert.doesNotMatch(
    publicAndExistingLocalSources,
    /local-panda-reply-ingress-payload|buildLocalPandaReplyIngressPayloadV1|LocalPandaReplyIngressPayloadV1|local-panda-reply-ingress/,
  );
});

function validDispatchPayload(
  correlationOverrides: Partial<LocalPandaReplyIngressCorrelationIds> = {},
  overrides: Partial<LocalPandaDispatchPayloadV1> = {},
): LocalPandaDispatchPayloadV1 {
  const ids = correlationIds(correlationOverrides);

  return {
    version: 1,
    kind: 'local-panda-future-dispatch',
    idempotencyKey: 'local-panda-dispatch-v1:base-dispatch-key',
    routeHandleSnapshot: 'panda:workspace/alpha',
    intent: {
      id: ids.intentId,
      status: 'claimed',
      createdAt: '2026-01-01T00:00:00.000Z',
      claimedAt: '2026-01-01T00:10:00.000Z',
    },
    widget: { id: ids.widgetId },
    conversation: { id: ids.conversationId },
    visitorSession: { id: ids.visitorSessionId },
    visitorMessage: {
      id: ids.visitorMessageId,
      clientMessageId: ids.clientMessageId,
      body: 'Hello from the visitor',
      text: 'Hello from the visitor',
      createdAt: '2026-01-01T00:05:00.000Z',
    },
    correlationIds: ids,
    metadata: {
      locality: 'local-only',
      dispatch: 'future-dispatch',
      contract: 'contract-only',
      network: 'no-network',
      stateMutation: 'no-state-mutation',
      replyHandling: 'no-reply-handling',
    },
    ...overrides,
  };
}

function replyFor(
  dispatchPayload: LocalPandaDispatchPayloadV1,
  text: string,
): BuildLocalPandaReplyIngressPayloadV1Input['reply'] {
  return {
    correlationIds: correlationIds(dispatchPayload.correlationIds),
    text,
  };
}

function correlationIds(
  overrides: Partial<LocalPandaReplyIngressCorrelationIds> = {},
): LocalPandaReplyIngressCorrelationIds {
  return {
    ...baseCorrelationIds,
    ...overrides,
  };
}

async function readSourceTree(directory: URL): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks: string[] = [];

  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);

    if (entry.isDirectory()) {
      chunks.push(await readSourceTree(child));
    } else if (entry.isFile() && /\.(css|html|js|jsx|json|ts|tsx)$/.test(entry.name)) {
      chunks.push(await readFile(child, 'utf8'));
    }
  }

  return chunks.join('\n');
}
