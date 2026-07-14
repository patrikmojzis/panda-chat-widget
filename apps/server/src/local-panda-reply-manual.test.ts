import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import type { DatabaseClient, MessageSender, PandaDeliveryIntentStatus } from './db.ts';
import {
  runLocalPandaReplyManualCli,
  type LocalPandaReplyManualCliDependencies,
} from './local-panda-reply-manual-cli.ts';
import {
  runNextLocalPandaReplyManual,
  type LocalPandaReplyManualInput,
  type LocalPandaReplyManualMetadata,
  type LocalPandaReplyManualResult,
} from './local-panda-reply-manual.ts';

type StoredConversation = {
  id: string;
  widget_id: string;
  visitor_session_id: string | null;
};

type StoredPandaDeliveryIntent = {
  id: string;
  widget_id: string;
  conversation_id: string;
  visitor_session_id: string;
  visitor_message_id: string;
  client_message_id: string;
  route_handle_snapshot: string;
  status: PandaDeliveryIntentStatus;
  claimed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type StoredMessage = {
  id: string;
  conversation_id: string;
  seq: number;
  sender: MessageSender;
  client_message_id: string | null;
  body: string;
  created_at: Date;
};

type MessageInsertValues = Omit<StoredMessage, 'id'>;

type WhereClause = {
  column: string;
  operator: string;
  value: unknown;
};

type WhereArguments = [string, string, unknown] | [(builder: ReturnType<typeof createExpressionBuilder>) => unknown];

type OrderClause = {
  column: string;
  direction: string;
};

type SelectLog = {
  table: string;
  selectedColumns: string[];
  wheres: WhereClause[];
  orders: OrderClause[];
  forUpdate: boolean;
  skipLocked: boolean;
  limit: number | undefined;
};

type UpdateLog = {
  table: string;
  updates: Partial<StoredPandaDeliveryIntent>;
  wheres: WhereClause[];
  returningColumns: string[];
};

type FakeDatabaseOptions = {
  conversations?: StoredConversation[];
  intents?: StoredPandaDeliveryIntent[];
  messages?: StoredMessage[];
  insertConcurrentLocalReplyAfterClaimedCandidateSelection?: boolean;
  concurrentLocalReplyBody?: string;
};

type FakeDatabase = {
  database: DatabaseClient;
  conversations: StoredConversation[];
  intents: StoredPandaDeliveryIntent[];
  messages: StoredMessage[];
  selects: SelectLog[];
  updates: UpdateLog[];
  messageInserts: MessageInsertValues[];
  transactions: number;
};

type ManualCliRunOptions = {
  input: string;
  closeDatabase?: LocalPandaReplyManualCliDependencies['closeDatabase'];
  createDatabase?: LocalPandaReplyManualCliDependencies['createDatabase'];
  loadDatabaseConfig?: LocalPandaReplyManualCliDependencies['loadDatabaseConfig'];
  runNextLocalPandaReplyManual?: LocalPandaReplyManualCliDependencies['runNextLocalPandaReplyManual'];
};

type ManualCliRun = {
  stdout: string[];
  stderr: string[];
  exitCodes: number[];
};

const NOW = new Date('2026-01-01T00:00:00.000Z');
const CLAIMED_AND_REPLY_AT = new Date('2026-01-01T00:10:00.000Z');
const VISITOR_MESSAGE_CREATED_AT = new Date('2026-01-01T00:05:00.000Z');
const CONCURRENT_REPLY_CREATED_AT = new Date('2026-01-01T00:15:00.000Z');
const MANUAL_REPLY_TEXT = 'Hello from the local manual reply';
const OTHER_MANUAL_REPLY_TEXT = 'Different manual reply text';
const MANUAL_REPLY_KIND = 'local-panda-one-shot-manual-reply-round-trip';
const MANUAL_REPLY_MODE = 'local-only-stdin-manual-reply';
const REPLY_IDEMPOTENCY_KEY = 'local-panda-reply-v1:intent-1';
const TARGET_INTENT_ID = '11111111-1111-4111-8111-111111111111';
const OLDER_QUEUED_INTENT_ID = '00000000-0000-4000-8000-000000000000';
const CLAIMED_INTENT_ID = '22222222-2222-4222-8222-222222222222';
const NEWER_QUEUED_INTENT_ID = '33333333-3333-4333-8333-333333333333';
const APPLIED_LOCAL_REPLY_NOT_EXISTS_SENTINEL = '__applied_local_reply_not_exists__';
const manualSource = await readFile(new URL('./local-panda-reply-manual.ts', import.meta.url), 'utf8');
const manualCliSource = await readFile(new URL('./local-panda-reply-manual-cli.ts', import.meta.url), 'utf8');
const roundTripSource = await readFile(new URL('./local-panda-reply-round-trip.ts', import.meta.url), 'utf8');
const appSource = await readFile(new URL('./app.ts', import.meta.url), 'utf8');
const visitorMessageSource = await readFile(new URL('./visitor-message.ts', import.meta.url), 'utf8');
const serverPackageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8');
const readmeSource = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
const consoleSource = await readSourceTree(new URL('../../console/src/', import.meta.url));
const widgetUiSource = await readSourceTree(new URL('../../widget-ui/src/', import.meta.url));

function createFakeDatabase(options: FakeDatabaseOptions = {}): FakeDatabase {
  const conversations = [...(options.conversations ?? [conversationRow()])];
  const intents = [...(options.intents ?? [intentRow()])];
  const messages = [...(options.messages ?? [visitorMessageRow()])];
  const selects: SelectLog[] = [];
  const updates: UpdateLog[] = [];
  const messageInserts: MessageInsertValues[] = [];
  let transactions = 0;

  function createSelectQuery(table: string) {
    let selectedColumns: string[] = [];
    const wheres: WhereClause[] = [];
    const orders: OrderClause[] = [];
    let forUpdate = false;
    let skipLocked = false;
    let limit: number | undefined;

    const query = {
      select: (columns: string | string[]) => {
        selectedColumns = Array.isArray(columns) ? columns : [columns];
        return query;
      },
      where: (...args: WhereArguments) => {
        appendWhereClause(wheres, args);
        return query;
      },
      orderBy: (column: string, direction: string) => {
        orders.push({ column, direction });
        return query;
      },
      forUpdate: () => {
        forUpdate = true;
        return query;
      },
      skipLocked: () => {
        skipLocked = true;
        return query;
      },
      limit: (count: number) => {
        limit = count;
        return query;
      },
      executeTakeFirst: async () => {
        selects.push({
          table,
          selectedColumns: [...selectedColumns],
          wheres: wheres.map((where) => ({ ...where })),
          orders: orders.map((order) => ({ ...order })),
          forUpdate,
          skipLocked,
          limit,
        });

        if (table === 'conversations') {
          return conversations.find((row) => matchesWhereClauses(row, wheres, messages));
        }

        if (table === 'panda_delivery_intents') {
          const rows = sortRows(intents.filter((row) => matchesWhereClauses(row, wheres, messages)), orders);
          const selected = limit === undefined ? rows[0] : rows.slice(0, limit)[0];

          if (
            selected &&
            options.insertConcurrentLocalReplyAfterClaimedCandidateSelection === true &&
            wheres.some((where) => where.column === APPLIED_LOCAL_REPLY_NOT_EXISTS_SENTINEL) &&
            !hasAppliedLocalReply(selected, messages)
          ) {
            messages.push(
              localReplyMessageForIntent(selected, {
                body: options.concurrentLocalReplyBody ?? MANUAL_REPLY_TEXT,
                created_at: CONCURRENT_REPLY_CREATED_AT,
              }),
            );
          }

          return selected;
        }

        if (table === 'messages') {
          const rows = sortRows(messages.filter((row) => matchesWhereClauses(row, wheres, messages)), orders);
          return limit === undefined ? rows[0] : rows.slice(0, limit)[0];
        }

        throw new Error(`Unexpected select table ${table}`);
      },
    };

    return query;
  }

  function createIntentUpdateQuery(table: string) {
    assert.equal(table, 'panda_delivery_intents');
    let pendingUpdates: Partial<StoredPandaDeliveryIntent> = {};
    const wheres: WhereClause[] = [];
    let returningColumns: string[] = [];

    const query = {
      set: (values: Partial<StoredPandaDeliveryIntent>) => {
        pendingUpdates = values;
        return query;
      },
      where: (column: string, operator: string, value: unknown) => {
        wheres.push({ column, operator, value });
        return query;
      },
      returning: (columns: string | string[]) => {
        returningColumns = Array.isArray(columns) ? columns : [columns];
        return query;
      },
      executeTakeFirst: async () => {
        updates.push({
          table,
          updates: { ...pendingUpdates },
          wheres: wheres.map((where) => ({ ...where })),
          returningColumns: [...returningColumns],
        });
        const row = intents.find((intent) => matchesWhereClauses(intent, wheres, messages));

        if (!row) {
          return undefined;
        }

        Object.assign(row, pendingUpdates);

        return row;
      },
    };

    return query;
  }

  function createMessageInsertQuery(table: string) {
    assert.equal(table, 'messages');
    let pendingValues: MessageInsertValues | undefined;

    const conflictBuilder = {
      where: (_column: string, _operator: string, _value: null) => conflictBuilder,
      doNothing: () => query,
    };

    const query = {
      values: (values: MessageInsertValues) => {
        pendingValues = values;
        return query;
      },
      onConflict: (
        buildConflict: (builder: {
          columns: (columns: string[]) => typeof conflictBuilder;
        }) => unknown,
      ) => {
        buildConflict({ columns: () => conflictBuilder });
        return query;
      },
      returning: () => query,
      executeTakeFirst: async () => {
        if (!pendingValues) {
          throw new Error('missing message insert values');
        }

        const duplicateClientMessage = messages.find(
          (message) =>
            message.conversation_id === pendingValues?.conversation_id &&
            message.client_message_id === pendingValues?.client_message_id &&
            message.client_message_id !== null,
        );

        if (duplicateClientMessage) {
          return undefined;
        }

        messageInserts.push(pendingValues);
        const inserted = {
          id: `message-${messages.length + 1}`,
          ...pendingValues,
        };
        messages.push(inserted);

        return inserted;
      },
    };

    return query;
  }

  const database = {
    transaction: () => ({
      execute: async (callback: (transaction: DatabaseClient) => Promise<unknown>) => {
        transactions += 1;
        return callback(database as unknown as DatabaseClient);
      },
    }),
    selectFrom: createSelectQuery,
    updateTable: createIntentUpdateQuery,
    insertInto: createMessageInsertQuery,
  } as unknown as DatabaseClient;

  return {
    database,
    conversations,
    intents,
    messages,
    selects,
    updates,
    messageInserts,
    get transactions() {
      return transactions;
    },
  };
}

test('runNextLocalPandaReplyManual claims one queued intent and inserts the manual local agent reply', async () => {
  const fake = createFakeDatabase({
    messages: [visitorMessageRow({ body: 'Visitor body that must not be echoed' })],
  });

  const result = await runNextLocalPandaReplyManual(
    fake.database,
    { normalizedReplyText: MANUAL_REPLY_TEXT },
    { now: CLAIMED_AND_REPLY_AT },
  );

  assert.equal(result.completed, true);

  if (!result.completed) {
    assert.fail('expected completed manual reply');
  }

  assertManualEnvelope(result);
  assert.equal(result.dispatchIntentSource, 'newly-claimed-queued-local-intent');
  assert.equal(result.dispatchPayload.intent.status, 'claimed');
  assert.equal(result.dispatchPayload.intent.claimedAt, CLAIMED_AND_REPLY_AT.toISOString());
  assert.equal(result.manualReplyIngressPayload.reply.text, MANUAL_REPLY_TEXT);
  assert.equal(result.manualReplyIngressPayload.reply.body, MANUAL_REPLY_TEXT);
  assert.equal(result.manualReplyIngressPayload.reply.text.includes('Visitor body that must not be echoed'), false);
  assert.equal(result.manualReplyIngressPayload.reply.text.includes('Deterministic local fake reply'), false);
  assert.deepEqual(result.applyResult, {
    applied: true,
    inserted: true,
    message: {
      id: 'message-2',
      conversationId: 'conversation-1',
      seq: 2,
      sender: 'agent',
      clientMessageId: REPLY_IDEMPOTENCY_KEY,
      body: MANUAL_REPLY_TEXT,
      createdAt: CLAIMED_AND_REPLY_AT,
    },
  });
  assert.deepEqual(fake.messageInserts, [
    {
      conversation_id: 'conversation-1',
      seq: 2,
      sender: 'agent',
      client_message_id: REPLY_IDEMPOTENCY_KEY,
      body: MANUAL_REPLY_TEXT,
      created_at: CLAIMED_AND_REPLY_AT,
    },
  ]);
  assert.equal(fake.intents[0]?.status, 'claimed');
  assert.equal(fake.intents[0]?.claimed_at, CLAIMED_AND_REPLY_AT);
});

test('runNextLocalPandaReplyManual reuses an already-claimed unapplied intent before queued work', async () => {
  const claimedIntent = intentRow({
    id: 'claimed-intent',
    status: 'claimed',
    claimed_at: new Date('2026-01-01T00:01:00.000Z'),
    visitor_message_id: 'claimed-visitor-message',
    client_message_id: 'claimed-client-message',
  });
  const queuedIntent = intentRow({
    id: 'queued-intent',
    visitor_message_id: 'queued-visitor-message',
    client_message_id: 'queued-client-message',
    created_at: new Date('2025-12-31T23:59:00.000Z'),
  });
  const fake = createFakeDatabase({
    intents: [queuedIntent, claimedIntent],
    messages: [
      visitorMessageRowForIntent(claimedIntent),
      visitorMessageRowForIntent(queuedIntent, { id: 'queued-visitor-message', seq: 2 }),
    ],
  });

  const result = await runNextLocalPandaReplyManual(
    fake.database,
    { normalizedReplyText: MANUAL_REPLY_TEXT },
    { now: CLAIMED_AND_REPLY_AT },
  );

  assert.equal(result.completed, true);

  if (!result.completed) {
    assert.fail('expected completed manual reply');
  }

  assert.equal(result.dispatchIntentSource, 'already-claimed-unapplied-local-intent');
  assert.equal(result.dispatchPayload.correlationIds.intentId, 'claimed-intent');
  assert.equal(result.manualReplyIngressPayload.idempotencyKey, replyIdempotencyKeyForIntent('claimed-intent'));
  assert.equal(result.manualReplyIngressPayload.reply.text, MANUAL_REPLY_TEXT);
  assert.equal(queuedIntent.status, 'queued');
  assert.equal(queuedIntent.claimed_at, null);
  assert.deepEqual(fake.updates, []);
  assert.equal(fake.messageInserts.length, 1);
  assert.equal(fake.messageInserts[0]?.client_message_id, replyIdempotencyKeyForIntent('claimed-intent'));
  assert.equal(fake.messageInserts[0]?.body, MANUAL_REPLY_TEXT);
});

test('runNextLocalPandaReplyManual targets and claims the exact queued intent without falling back to older candidates', async () => {
  const olderQueuedIntent = intentRow({
    id: OLDER_QUEUED_INTENT_ID,
    visitor_message_id: 'older-queued-visitor-message',
    client_message_id: 'older-queued-client-message',
    created_at: new Date('2025-12-31T23:50:00.000Z'),
  });
  const olderClaimedIntent = intentRow({
    id: CLAIMED_INTENT_ID,
    status: 'claimed',
    claimed_at: new Date('2026-01-01T00:01:00.000Z'),
    visitor_message_id: 'claimed-visitor-message',
    client_message_id: 'claimed-client-message',
    created_at: new Date('2025-12-31T23:55:00.000Z'),
  });
  const targetQueuedIntent = intentRow({
    id: TARGET_INTENT_ID,
    visitor_message_id: 'target-visitor-message',
    client_message_id: 'target-client-message',
    created_at: new Date('2026-01-01T00:02:00.000Z'),
  });
  const fake = createFakeDatabase({
    intents: [olderQueuedIntent, olderClaimedIntent, targetQueuedIntent],
    messages: [
      visitorMessageRowForIntent(olderQueuedIntent, { seq: 1 }),
      visitorMessageRowForIntent(olderClaimedIntent, { seq: 2 }),
      visitorMessageRowForIntent(targetQueuedIntent, { seq: 3 }),
    ],
  });

  const result = await runNextLocalPandaReplyManual(
    fake.database,
    { normalizedReplyText: MANUAL_REPLY_TEXT, targetIntentId: TARGET_INTENT_ID },
    { now: CLAIMED_AND_REPLY_AT },
  );

  assert.equal(result.completed, true);

  if (!result.completed) {
    assert.fail('expected completed targeted manual reply');
  }

  assert.equal(result.targetIntentId, TARGET_INTENT_ID);
  assert.equal(result.dispatchIntentSource, 'targeted-newly-claimed-queued-local-intent');
  assert.equal(result.dispatchPayload.correlationIds.intentId, TARGET_INTENT_ID);
  assert.equal(result.manualReplyIngressPayload.idempotencyKey, replyIdempotencyKeyForIntent(TARGET_INTENT_ID));
  assert.equal(result.manualReplyIngressPayload.reply.text, MANUAL_REPLY_TEXT);
  assert.equal(olderQueuedIntent.status, 'queued');
  assert.equal(olderQueuedIntent.claimed_at, null);
  assert.equal(olderClaimedIntent.status, 'claimed');
  assert.equal(olderClaimedIntent.claimed_at?.toISOString(), '2026-01-01T00:01:00.000Z');
  assert.equal(targetQueuedIntent.status, 'claimed');
  assert.equal(targetQueuedIntent.claimed_at, CLAIMED_AND_REPLY_AT);
  assert.deepEqual(fake.updates.map((update) => update.wheres), [
    [
      { column: 'id', operator: '=', value: TARGET_INTENT_ID },
      { column: 'status', operator: '=', value: 'queued' },
    ],
  ]);
  assert.equal(fake.messageInserts.length, 1);
  assert.equal(fake.messageInserts[0]?.client_message_id, replyIdempotencyKeyForIntent(TARGET_INTENT_ID));
});

test('runNextLocalPandaReplyManual targets an already-claimed unapplied intent without claiming queued work', async () => {
  const targetClaimedIntent = intentRow({
    id: CLAIMED_INTENT_ID,
    status: 'claimed',
    claimed_at: new Date('2026-01-01T00:01:00.000Z'),
    visitor_message_id: 'target-claimed-visitor-message',
    client_message_id: 'target-claimed-client-message',
  });
  const queuedIntent = intentRow({
    id: NEWER_QUEUED_INTENT_ID,
    visitor_message_id: 'queued-visitor-message',
    client_message_id: 'queued-client-message',
    created_at: new Date('2025-12-31T23:59:00.000Z'),
  });
  const fake = createFakeDatabase({
    intents: [queuedIntent, targetClaimedIntent],
    messages: [
      visitorMessageRowForIntent(queuedIntent, { seq: 1 }),
      visitorMessageRowForIntent(targetClaimedIntent, { seq: 2 }),
    ],
  });

  const result = await runNextLocalPandaReplyManual(
    fake.database,
    { normalizedReplyText: MANUAL_REPLY_TEXT, targetIntentId: CLAIMED_INTENT_ID },
    { now: CLAIMED_AND_REPLY_AT },
  );

  assert.equal(result.completed, true);

  if (!result.completed) {
    assert.fail('expected completed targeted manual reply');
  }

  assert.equal(result.targetIntentId, CLAIMED_INTENT_ID);
  assert.equal(result.dispatchIntentSource, 'targeted-already-claimed-unapplied-local-intent');
  assert.equal(result.dispatchPayload.correlationIds.intentId, CLAIMED_INTENT_ID);
  assert.equal(result.manualReplyIngressPayload.idempotencyKey, replyIdempotencyKeyForIntent(CLAIMED_INTENT_ID));
  assert.equal(queuedIntent.status, 'queued');
  assert.equal(queuedIntent.claimed_at, null);
  assert.deepEqual(fake.updates, []);
  assert.equal(fake.messageInserts.length, 1);
  assert.equal(fake.messageInserts[0]?.client_message_id, replyIdempotencyKeyForIntent(CLAIMED_INTENT_ID));
});

test('runNextLocalPandaReplyManual returns targeted no-op dispatch JSON without falling back', async () => {
  const fallbackQueuedIntent = intentRow({
    id: OLDER_QUEUED_INTENT_ID,
    visitor_message_id: 'fallback-visitor-message',
    client_message_id: 'fallback-client-message',
  });
  const appliedTargetIntent = intentRow({
    id: TARGET_INTENT_ID,
    visitor_message_id: 'applied-target-visitor-message',
    client_message_id: 'applied-target-client-message',
  });
  const notReplyableTargetIntent = intentRow({
    id: CLAIMED_INTENT_ID,
    status: 'claimed',
    claimed_at: null,
    visitor_message_id: 'not-replyable-target-visitor-message',
    client_message_id: 'not-replyable-target-client-message',
  });
  const cases: Array<{
    name: string;
    targetIntentId: string;
    intents: StoredPandaDeliveryIntent[];
    messages: StoredMessage[];
    reason: 'target_intent_not_found' | 'target_intent_already_applied' | 'target_intent_not_replyable';
  }> = [
    {
      name: 'missing target',
      targetIntentId: TARGET_INTENT_ID,
      intents: [fallbackQueuedIntent],
      messages: [visitorMessageRowForIntent(fallbackQueuedIntent)],
      reason: 'target_intent_not_found',
    },
    {
      name: 'already applied target',
      targetIntentId: TARGET_INTENT_ID,
      intents: [fallbackQueuedIntent, appliedTargetIntent],
      messages: [
        visitorMessageRowForIntent(fallbackQueuedIntent, { seq: 1 }),
        visitorMessageRowForIntent(appliedTargetIntent, { seq: 2 }),
        localReplyMessageForIntent(appliedTargetIntent, { seq: 3 }),
      ],
      reason: 'target_intent_already_applied',
    },
    {
      name: 'not replyable target',
      targetIntentId: CLAIMED_INTENT_ID,
      intents: [fallbackQueuedIntent, notReplyableTargetIntent],
      messages: [
        visitorMessageRowForIntent(fallbackQueuedIntent, { seq: 1 }),
        visitorMessageRowForIntent(notReplyableTargetIntent, { seq: 2 }),
      ],
      reason: 'target_intent_not_replyable',
    },
  ];

  for (const testCase of cases) {
    const fake = createFakeDatabase({
      intents: testCase.intents.map((intent) => ({ ...intent })),
      messages: testCase.messages.map((message) => ({ ...message })),
    });

    const result = await runNextLocalPandaReplyManual(
      fake.database,
      { normalizedReplyText: MANUAL_REPLY_TEXT, targetIntentId: testCase.targetIntentId },
      { now: CLAIMED_AND_REPLY_AT },
    );

    assert.deepEqual(result, {
      ...manualReplyBase(),
      targetIntentId: testCase.targetIntentId,
      completed: false,
      parsed: true,
      failedStep: 'dispatch_prepare',
      reason: testCase.reason,
    }, testCase.name);
    assert.equal('dispatchIntentSource' in result, false, testCase.name);
    assert.deepEqual(fake.updates, [], testCase.name);
    assert.deepEqual(fake.messageInserts, [], testCase.name);
    assert.equal(
      fake.intents.find((intent) => intent.id === OLDER_QUEUED_INTENT_ID)?.status,
      'queued',
      testCase.name,
    );
  }
});

test('runNextLocalPandaReplyManual includes target id and source on targeted dispatch build failures', async () => {
  const invalidTargetIntent = intentRow({
    id: TARGET_INTENT_ID,
    route_handle_snapshot: '',
    visitor_message_id: 'target-visitor-message',
    client_message_id: 'target-client-message',
  });
  const fake = createFakeDatabase({
    intents: [invalidTargetIntent],
    messages: [visitorMessageRowForIntent(invalidTargetIntent)],
  });

  const result = await runNextLocalPandaReplyManual(
    fake.database,
    { normalizedReplyText: MANUAL_REPLY_TEXT, targetIntentId: TARGET_INTENT_ID },
    { now: CLAIMED_AND_REPLY_AT },
  );

  assert.deepEqual(result, {
    ...manualReplyBase(),
    targetIntentId: TARGET_INTENT_ID,
    completed: false,
    parsed: true,
    failedStep: 'dispatch_prepare',
    reason: 'missing_route_handle',
    dispatchIntentSource: 'targeted-newly-claimed-queued-local-intent',
  });
  assert.equal(invalidTargetIntent.status, 'claimed');
  assert.equal(invalidTargetIntent.claimed_at, CLAIMED_AND_REPLY_AT);
  assert.deepEqual(fake.messageInserts, []);
});

test('runNextLocalPandaReplyManual replays and conflicts through the apply helper without duplicate local reply rows', async () => {
  const replayExisting = localReplyMessageForIntent(intentRow(), {
    id: 'existing-manual-reply',
    body: MANUAL_REPLY_TEXT,
    created_at: CLAIMED_AND_REPLY_AT,
  });
  const replayFake = createFakeDatabase({ messages: [visitorMessageRow(), replayExisting] });

  const replayResult = await runNextLocalPandaReplyManual(
    replayFake.database,
    { normalizedReplyText: MANUAL_REPLY_TEXT },
    { now: new Date('2026-01-01T00:20:00.000Z') },
  );

  assert.equal(replayResult.completed, true);

  if (!replayResult.completed) {
    assert.fail('expected idempotent manual replay');
  }

  assert.equal(replayResult.dispatchIntentSource, 'newly-claimed-queued-local-intent');
  assert.deepEqual(replayResult.applyResult, {
    applied: true,
    inserted: false,
    message: {
      id: 'existing-manual-reply',
      conversationId: 'conversation-1',
      seq: 2,
      sender: 'agent',
      clientMessageId: REPLY_IDEMPOTENCY_KEY,
      body: MANUAL_REPLY_TEXT,
      createdAt: CLAIMED_AND_REPLY_AT,
    },
  });
  assert.deepEqual(replayFake.messageInserts, []);
  assert.equal(replayFake.messages.filter((message) => message.client_message_id === REPLY_IDEMPOTENCY_KEY).length, 1);

  const conflictExisting = localReplyMessageForIntent(intentRow(), {
    id: 'conflicting-manual-reply',
    body: OTHER_MANUAL_REPLY_TEXT,
    created_at: CLAIMED_AND_REPLY_AT,
  });
  const conflictFake = createFakeDatabase({ messages: [visitorMessageRow(), conflictExisting] });

  const conflictResult = await runNextLocalPandaReplyManual(
    conflictFake.database,
    { normalizedReplyText: MANUAL_REPLY_TEXT },
    { now: new Date('2026-01-01T00:20:00.000Z') },
  );

  assert.equal(conflictResult.completed, false);

  if (conflictResult.completed || conflictResult.failedStep !== 'apply_reply_ingress') {
    assert.fail('expected idempotency conflict through apply helper');
  }

  assert.equal(conflictResult.reason, 'idempotency_conflict');
  assert.deepEqual(conflictResult.applyResult, { applied: false, reason: 'idempotency_conflict' });
  assert.deepEqual(conflictFake.messageInserts, []);
  assert.equal(conflictFake.messages.filter((message) => message.client_message_id === REPLY_IDEMPOTENCY_KEY).length, 1);
});

test('runLocalPandaReplyManualCli rejects parse and manual text validation failures before DB config, core, or dispatch prep', async () => {
  const cases: Array<{
    name: string;
    input: string;
    parsed: boolean;
    failedStep: 'stdin_parse' | 'manual_reply_validation';
    reason: string;
  }> = [
    { name: 'empty stdin', input: '', parsed: false, failedStep: 'stdin_parse', reason: 'empty_stdin' },
    { name: 'whitespace stdin', input: '  \n\t', parsed: false, failedStep: 'stdin_parse', reason: 'empty_stdin' },
    { name: 'malformed JSON', input: '{', parsed: false, failedStep: 'stdin_parse', reason: 'malformed_json' },
    { name: 'null JSON', input: 'null', parsed: false, failedStep: 'stdin_parse', reason: 'json_value_not_object' },
    { name: 'array JSON', input: '[]', parsed: false, failedStep: 'stdin_parse', reason: 'json_value_not_object' },
    { name: 'scalar JSON', input: '123', parsed: false, failedStep: 'stdin_parse', reason: 'json_value_not_object' },
    {
      name: 'missing reply object',
      input: '{}',
      parsed: true,
      failedStep: 'manual_reply_validation',
      reason: 'missing_reply_text',
    },
    {
      name: 'missing reply text',
      input: '{"reply":{}}',
      parsed: true,
      failedStep: 'manual_reply_validation',
      reason: 'missing_reply_text',
    },
    {
      name: 'blank reply text',
      input: JSON.stringify({ reply: { text: '  \n\t  ' } }),
      parsed: true,
      failedStep: 'manual_reply_validation',
      reason: 'missing_reply_text',
    },
    {
      name: 'undefined-like missing reply text',
      input: '{"reply":{"text":null}}',
      parsed: true,
      failedStep: 'manual_reply_validation',
      reason: 'invalid_reply_text',
    },
    {
      name: 'non-string reply text',
      input: '{"reply":{"text":123}}',
      parsed: true,
      failedStep: 'manual_reply_validation',
      reason: 'invalid_reply_text',
    },
    {
      name: 'non-string target intent id',
      input: JSON.stringify({ targetIntentId: 123, reply: { text: MANUAL_REPLY_TEXT } }),
      parsed: true,
      failedStep: 'manual_reply_validation',
      reason: 'invalid_target_intent_id',
    },
    {
      name: 'blank target intent id',
      input: JSON.stringify({ targetIntentId: '  \n\t  ', reply: { text: MANUAL_REPLY_TEXT } }),
      parsed: true,
      failedStep: 'manual_reply_validation',
      reason: 'invalid_target_intent_id',
    },
    {
      name: 'malformed target intent id',
      input: JSON.stringify({ targetIntentId: 'intent-1', reply: { text: MANUAL_REPLY_TEXT } }),
      parsed: true,
      failedStep: 'manual_reply_validation',
      reason: 'invalid_target_intent_id',
    },
  ];

  for (const testCase of cases) {
    let loadDatabaseConfigCount = 0;
    let createDatabaseCount = 0;
    let coreRunCount = 0;
    let dispatchPrepCount = 0;
    const run = await runManualCli({
      input: testCase.input,
      loadDatabaseConfig: () => {
        loadDatabaseConfigCount += 1;
        throw new Error('loadDatabaseConfig must not be called before manual reply text is valid');
      },
      createDatabase: () => {
        createDatabaseCount += 1;
        throw new Error('createDatabase must not be called before manual reply text is valid');
      },
      runNextLocalPandaReplyManual: async () => {
        coreRunCount += 1;
        dispatchPrepCount += 1;
        throw new Error('core/dispatch prep must not be called before manual reply text is valid');
      },
    });
    const envelope = parseCliJsonObject(run.stdout[0]);

    assertManualBaseEnvelope(envelope);
    assert.equal(envelope.completed, false, testCase.name);
    assert.equal(envelope.parsed, testCase.parsed, testCase.name);
    assert.equal(envelope.failedStep, testCase.failedStep, testCase.name);
    assert.equal(envelope.reason, testCase.reason, testCase.name);
    assert.deepEqual(run.stderr, [], testCase.name);
    assert.deepEqual(run.exitCodes, [1], testCase.name);
    assert.equal(loadDatabaseConfigCount, 0, testCase.name);
    assert.equal(createDatabaseCount, 0, testCase.name);
    assert.equal(coreRunCount, 0, testCase.name);
    assert.equal(dispatchPrepCount, 0, testCase.name);
  }
});

test('runLocalPandaReplyManualCli normalizes valid reply text before opening DB and closes on controlled results', async () => {
  const database = {} as DatabaseClient;
  const controlledResult: LocalPandaReplyManualResult = {
    ...manualReplyBase(),
    completed: false,
    parsed: true,
    failedStep: 'dispatch_prepare',
    reason: 'no_queued_intent',
  };
  let closedDatabase: DatabaseClient | undefined;
  let normalizedInput: LocalPandaReplyManualInput | undefined;

  const run = await runManualCli({
    input: JSON.stringify({ reply: { text: `  ${MANUAL_REPLY_TEXT}  ` } }),
    loadDatabaseConfig: () => ({ url: 'postgresql://user:pass@127.0.0.1:5432/widget' }),
    createDatabase: (config) => {
      assert.equal(config.url, 'postgresql://user:pass@127.0.0.1:5432/widget');

      return database;
    },
    runNextLocalPandaReplyManual: async (client, input) => {
      assert.equal(client, database);
      normalizedInput = input;

      return controlledResult;
    },
    closeDatabase: async (client) => {
      closedDatabase = client;
    },
  });

  assert.equal(closedDatabase, database);
  assert.deepEqual(normalizedInput, { normalizedReplyText: MANUAL_REPLY_TEXT });
  assert.deepEqual(run.stdout, [`${JSON.stringify(controlledResult, null, 2)}\n`]);
  assert.deepEqual(run.stderr, []);
  assert.deepEqual(run.exitCodes, []);
});

test('runLocalPandaReplyManualCli trims and passes a valid target intent id to core', async () => {
  const database = {} as DatabaseClient;
  const controlledResult: LocalPandaReplyManualResult = {
    ...manualReplyBase(),
    targetIntentId: TARGET_INTENT_ID,
    completed: false,
    parsed: true,
    failedStep: 'dispatch_prepare',
    reason: 'target_intent_not_found',
  };
  let normalizedInput: LocalPandaReplyManualInput | undefined;

  const run = await runManualCli({
    input: JSON.stringify({
      targetIntentId: `  ${TARGET_INTENT_ID.toUpperCase()}  `,
      reply: { text: `  ${MANUAL_REPLY_TEXT}  ` },
    }),
    loadDatabaseConfig: () => ({ url: 'postgresql://user:pass@127.0.0.1:5432/widget' }),
    createDatabase: () => database,
    runNextLocalPandaReplyManual: async (client, input) => {
      assert.equal(client, database);
      normalizedInput = input;

      return controlledResult;
    },
    closeDatabase: async () => {},
  });

  assert.deepEqual(normalizedInput, {
    normalizedReplyText: MANUAL_REPLY_TEXT,
    targetIntentId: TARGET_INTENT_ID,
  });
  assert.deepEqual(run.stdout, [`${JSON.stringify(controlledResult, null, 2)}\n`]);
  assert.deepEqual(run.stderr, []);
  assert.deepEqual(run.exitCodes, []);
});

test('runNextLocalPandaReplyManual returns controlled dispatch failures with source rules', async () => {
  const noQueued = await runNextLocalPandaReplyManual(
    createFakeDatabase({ intents: [] }).database,
    { normalizedReplyText: MANUAL_REPLY_TEXT },
    { now: CLAIMED_AND_REPLY_AT },
  );

  assert.deepEqual(noQueued, {
    ...manualReplyBase(),
    completed: false,
    parsed: true,
    failedStep: 'dispatch_prepare',
    reason: 'no_queued_intent',
  });
  assert.equal('dispatchIntentSource' in noQueued, false);

  const queuedBuildFailureFake = createFakeDatabase({ intents: [intentRow({ route_handle_snapshot: '' })] });
  const queuedBuildFailure = await runNextLocalPandaReplyManual(
    queuedBuildFailureFake.database,
    { normalizedReplyText: MANUAL_REPLY_TEXT },
    { now: CLAIMED_AND_REPLY_AT },
  );

  assert.deepEqual(queuedBuildFailure, {
    ...manualReplyBase(),
    completed: false,
    parsed: true,
    failedStep: 'dispatch_prepare',
    reason: 'missing_route_handle',
    dispatchIntentSource: 'newly-claimed-queued-local-intent',
  });
  assert.equal(queuedBuildFailureFake.intents[0]?.status, 'claimed');
  assert.equal(queuedBuildFailureFake.intents[0]?.claimed_at, CLAIMED_AND_REPLY_AT);

  const invalidClaimedIntent = intentRow({
    id: 'invalid-claimed-intent',
    status: 'claimed',
    claimed_at: new Date('2026-01-01T00:01:00.000Z'),
    route_handle_snapshot: '',
    visitor_message_id: 'invalid-claimed-visitor-message',
    client_message_id: 'invalid-claimed-client-message',
  });
  const queuedAfterInvalidClaimed = intentRow({
    id: 'queued-after-invalid-claimed',
    visitor_message_id: 'queued-after-invalid-claimed-visitor-message',
    client_message_id: 'queued-after-invalid-claimed-client-message',
  });
  const claimedBuildFailureFake = createFakeDatabase({
    intents: [invalidClaimedIntent, queuedAfterInvalidClaimed],
    messages: [
      visitorMessageRowForIntent(invalidClaimedIntent),
      visitorMessageRowForIntent(queuedAfterInvalidClaimed, { seq: 2 }),
    ],
  });
  const claimedBuildFailure = await runNextLocalPandaReplyManual(
    claimedBuildFailureFake.database,
    { normalizedReplyText: MANUAL_REPLY_TEXT },
    { now: CLAIMED_AND_REPLY_AT },
  );

  assert.deepEqual(claimedBuildFailure, {
    ...manualReplyBase(),
    completed: false,
    parsed: true,
    failedStep: 'dispatch_prepare',
    reason: 'missing_route_handle',
    dispatchIntentSource: 'already-claimed-unapplied-local-intent',
  });
  assert.equal(queuedAfterInvalidClaimed.status, 'queued');
  assert.equal(queuedAfterInvalidClaimed.claimed_at, null);
  assert.deepEqual(claimedBuildFailureFake.updates, []);
});

test('runNextLocalPandaReplyManual returns controlled manual reply ingress build failures', async () => {
  const fake = createFakeDatabase();

  const result = await runNextLocalPandaReplyManual(
    fake.database,
    { normalizedReplyText: MANUAL_REPLY_TEXT },
    { now: CLAIMED_AND_REPLY_AT },
    {
      buildLocalPandaReplyIngressPayloadV1: (input) => {
        assert.equal(input.reply.text, MANUAL_REPLY_TEXT);
        assert.deepEqual(input.reply.correlationIds, input.dispatchPayload.correlationIds);

        return { built: false, reason: 'invalid_dispatch_payload' };
      },
      applyLocalPandaReplyIngressPayloadV1: async () => {
        throw new Error('apply helper must not be called after ingress build failure');
      },
    },
  );

  assert.equal(result.completed, false);

  if (result.completed || result.failedStep !== 'manual_reply_ingress_build') {
    assert.fail('expected manual_reply_ingress_build failure');
  }

  assertManualEnvelope(result);
  assert.equal(result.reason, 'invalid_dispatch_payload');
  assert.equal(result.dispatchIntentSource, 'newly-claimed-queued-local-intent');
  assert.equal(result.dispatchPayload.correlationIds.intentId, 'intent-1');
  assert.deepEqual(result.buildResult, { built: false, reason: 'invalid_dispatch_payload' });
  assert.deepEqual(fake.messageInserts, []);
});

test('runNextLocalPandaReplyManual returns controlled apply failures after building manual reply ingress', async () => {
  const fake = createFakeDatabase({ conversations: [] });

  const result = await runNextLocalPandaReplyManual(
    fake.database,
    { normalizedReplyText: MANUAL_REPLY_TEXT },
    { now: CLAIMED_AND_REPLY_AT },
  );

  assert.equal(result.completed, false);

  if (result.completed || result.failedStep !== 'apply_reply_ingress') {
    assert.fail('expected apply_reply_ingress failure');
  }

  assertManualEnvelope(result);
  assert.equal(result.reason, 'conversation_not_found');
  assert.equal(result.dispatchIntentSource, 'newly-claimed-queued-local-intent');
  assert.equal(result.dispatchPayload.correlationIds.intentId, 'intent-1');
  assert.equal(result.manualReplyIngressPayload.reply.text, MANUAL_REPLY_TEXT);
  assert.deepEqual(result.applyResult, { applied: false, reason: 'conversation_not_found' });
  assert.equal(fake.intents[0]?.status, 'claimed');
  assert.equal(fake.intents[0]?.claimed_at, CLAIMED_AND_REPLY_AT);
  assert.deepEqual(fake.messageInserts, []);
});

test('runLocalPandaReplyManualCli writes safe stderr and exits 1 for unexpected errors', async () => {
  const database = {} as DatabaseClient;
  let closedDatabase: DatabaseClient | undefined;

  const run = await runManualCli({
    input: JSON.stringify({ reply: { text: MANUAL_REPLY_TEXT } }),
    loadDatabaseConfig: () => ({ url: 'postgresql://user:super-secret@127.0.0.1:5432/widget?token=abc' }),
    createDatabase: () => database,
    runNextLocalPandaReplyManual: async () => {
      throw new Error('manual reply failed postgresql://user:super-secret@127.0.0.1:5432/widget?token=abc');
    },
    closeDatabase: async (client) => {
      closedDatabase = client;
    },
  });

  assert.equal(closedDatabase, database);
  assert.deepEqual(run.stdout, []);
  assert.deepEqual(run.exitCodes, [1]);
  assert.equal(run.stderr[0], 'failed to run local Panda manual reply round trip from stdin\n');
  assert.deepEqual(JSON.parse(run.stderr[1] ?? '{}'), {
    name: 'Error',
    message: 'manual reply failed postgresql://user:[redacted]@127.0.0.1:5432/widget?token=[redacted]',
  });
  assert.equal(run.stderr.join('').includes('super-secret'), false);
  assert.equal(run.stderr.join('').includes('token=abc'), false);
  assert.equal(run.stderr.join('').includes('\n    at '), false);
});

test('manual reply CLI wiring stays local-only and documents the server-only stdin flow', () => {
  const serverPackage = JSON.parse(serverPackageSource) as { scripts?: Record<string, string> };
  const combinedManualSource = `${manualSource}\n${manualCliSource}`;
  const combinedFrontendSource = `${consoleSource}\n${widgetUiSource}`;

  assert.match(manualSource, /prepareLocalPandaReplyRoundTripDispatch/);
  assert.match(roundTripSource, /export async function prepareLocalPandaReplyRoundTripDispatch/);
  assert.match(manualSource, /buildLocalPandaReplyIngressPayloadV1/);
  assert.match(manualSource, /applyLocalPandaReplyIngressPayloadV1/);
  assert.match(manualSource, /manualReplySource: 'stdin-manual-reply-text'/);
  assert.doesNotMatch(combinedManualSource, /deterministic-local-fake-reply|syntheticFakeReplyIngressPayload|Deterministic local fake reply/);
  assert.equal(serverPackage.scripts?.['local-panda:reply-manual'], 'node dist/local-panda-reply-manual-cli.js');
  assert.match(
    readmeSource,
    /printf '%s\\n' '\{"reply":\{"text":"Hello from the local manual reply"\}\}' \| pnpm --silent --filter @panda-chat-widget\/server local-panda:reply-manual/,
  );
  assert.match(readmeSource, /kind: `"local-panda-one-shot-manual-reply-round-trip"`/);
  assert.match(readmeSource, /manualReplyIngressPayload/);
  assert.match(readmeSource, /nextLocalReplyCandidate\.id/);
  assert.match(readmeSource, /oldestQueuedIntent\.id/);
  assert.match(readmeSource, /targetIntentId/);
  assert.match(readmeSource, /targeted-newly-claimed-queued-local-intent/);
  assert.match(readmeSource, /targeted-already-claimed-unapplied-local-intent/);
  assert.match(readmeSource, /no fallback to the oldest candidate/);
  assert.match(readmeSource, /validates and normalizes `reply\.text` and any provided `targetIntentId` before opening the DB/);
  assert.match(readmeSource, /does not call Panda, Gateway, an external CLI, a child process, or the network/);
  assert.doesNotMatch(
    appSource,
    /local-panda-reply-manual|runNextLocalPandaReplyManual|runLocalPandaReplyManualCli|LocalPandaReplyManualResult/,
  );
  assert.doesNotMatch(
    visitorMessageSource,
    /local-panda-reply-manual|runNextLocalPandaReplyManual|runLocalPandaReplyManualCli|LocalPandaReplyManualResult/,
  );
  assert.doesNotMatch(
    combinedFrontendSource,
    /local-panda-reply-manual|runNextLocalPandaReplyManual|runLocalPandaReplyManualCli|LocalPandaReplyManualResult/,
  );
  assert.doesNotMatch(
    combinedManualSource,
    /fetch\s*\(|WebSocket|EventSource|node:http|node:https|node:child_process|child_process|spawn\s*\(|exec\s*\(|setTimeout\s*\(|setInterval\s*\(|Worker\s*\(|dispatcher|daemon|retry|dead-letter|fake-responder|createFakeResponderReply|reply-ingestion|\.schema|createTable|alterTable|addColumn|dropTable|dropColumn|status:\s*'sent'|status:\s*'delivered'|status:\s*'failed'|status:\s*'replied'|sent_at|delivered_at|failed_at|replied_at/i,
  );
  assert.doesNotMatch(
    combinedManualSource,
    /panda\s+(?:a2a|send|gateway)|gateway\s+(?:url|token|request|response|dispatch)/i,
  );
});

async function runManualCli(options: ManualCliRunOptions): Promise<ManualCliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  const dependencies: LocalPandaReplyManualCliDependencies = {
    readStdin: async () => options.input,
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
    setExitCode: (exitCode) => exitCodes.push(exitCode),
  };

  if (options.closeDatabase) {
    dependencies.closeDatabase = options.closeDatabase;
  }

  if (options.createDatabase) {
    dependencies.createDatabase = options.createDatabase;
  }

  if (options.loadDatabaseConfig) {
    dependencies.loadDatabaseConfig = options.loadDatabaseConfig;
  }

  if (options.runNextLocalPandaReplyManual) {
    dependencies.runNextLocalPandaReplyManual = options.runNextLocalPandaReplyManual;
  }

  await runLocalPandaReplyManualCli(dependencies);

  return { stdout, stderr, exitCodes };
}

function assertManualEnvelope(result: LocalPandaReplyManualResult): void {
  assert.equal(result.kind, MANUAL_REPLY_KIND);
  assert.equal(result.mode, MANUAL_REPLY_MODE);
  assert.deepEqual(result.metadata, expectedManualMetadata());
  assert.equal(result.parsed, true);
  assert.equal(JSON.stringify(result.metadata).includes('deterministic-local-fake-reply'), false);
}

function assertManualBaseEnvelope(envelope: Record<string, unknown>): void {
  assert.equal(envelope.kind, MANUAL_REPLY_KIND);
  assert.equal(envelope.mode, MANUAL_REPLY_MODE);
  assert.deepEqual(envelope.metadata, expectedManualMetadata());
}

function manualReplyBase(): Pick<LocalPandaReplyManualResult, 'kind' | 'mode' | 'metadata'> {
  return {
    kind: MANUAL_REPLY_KIND,
    mode: MANUAL_REPLY_MODE,
    metadata: expectedManualMetadata(),
  };
}

function expectedManualMetadata(): LocalPandaReplyManualMetadata {
  return {
    locality: 'local-only',
    input: 'stdin-json-object',
    manualReplySource: 'stdin-manual-reply-text',
    replyTextValidation: 'normalized-before-db-config-or-dispatch',
    network: 'no-network',
    pandaCall: 'not-attempted',
    gatewayCall: 'not-attempted',
    externalCliCall: 'not-attempted',
    childProcess: 'not-used',
    publicRoute: 'not-created',
    worker: 'not-created',
    frontendExposure: 'not-created',
    stateMutation: 'reuses-one-claimed-intent-or-claims-one-queued-intent-and-inserts-or-replays-one-local-agent-message',
    publicFakeReplyReplacement: 'not-attempted',
    postClaimFailure: 'intent-may-remain-claimed-after-dispatch-build-or-apply-failure',
    rollback: 'not-attempted',
    statusLifecycleExpansion: 'not-attempted',
  };
}

function conversationRow(values: Partial<StoredConversation> = {}): StoredConversation {
  return {
    id: 'conversation-1',
    widget_id: 'widget-1',
    visitor_session_id: 'visitor-session-1',
    ...values,
  };
}

function intentRow(values: Partial<StoredPandaDeliveryIntent> = {}): StoredPandaDeliveryIntent {
  return {
    id: 'intent-1',
    widget_id: 'widget-1',
    conversation_id: 'conversation-1',
    visitor_session_id: 'visitor-session-1',
    visitor_message_id: 'visitor-message-1',
    client_message_id: 'client-message-1',
    route_handle_snapshot: 'panda:local/demo',
    status: 'queued',
    claimed_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...values,
  };
}

function visitorMessageRow(values: Partial<StoredMessage> = {}): StoredMessage {
  return messageRow({
    id: 'visitor-message-1',
    seq: 1,
    sender: 'visitor',
    client_message_id: 'client-message-1',
    body: 'Hello from the visitor',
    created_at: VISITOR_MESSAGE_CREATED_AT,
    ...values,
  });
}

function visitorMessageRowForIntent(
  intent: StoredPandaDeliveryIntent,
  values: Partial<StoredMessage> = {},
): StoredMessage {
  return visitorMessageRow({
    id: intent.visitor_message_id,
    conversation_id: intent.conversation_id,
    client_message_id: intent.client_message_id,
    body: `Visitor message for ${intent.id}`,
    ...values,
  });
}

function localReplyMessageForIntent(
  intent: Pick<StoredPandaDeliveryIntent, 'id' | 'conversation_id'>,
  values: Partial<StoredMessage> = {},
): StoredMessage {
  return messageRow({
    id: `local-reply-${intent.id}`,
    conversation_id: intent.conversation_id,
    seq: 2,
    sender: 'agent',
    client_message_id: replyIdempotencyKeyForIntent(intent.id),
    body: MANUAL_REPLY_TEXT,
    created_at: CLAIMED_AND_REPLY_AT,
    ...values,
  });
}

function replyIdempotencyKeyForIntent(intentId: string): string {
  return `local-panda-reply-v1:${intentId}`;
}

function messageRow(values: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: 'message-1',
    conversation_id: 'conversation-1',
    seq: 1,
    sender: 'visitor',
    client_message_id: 'client-message-1',
    body: 'Hello from the visitor',
    created_at: VISITOR_MESSAGE_CREATED_AT,
    ...values,
  };
}

function parseCliJsonObject(stdoutLine: string | undefined): Record<string, any> {
  assert.ok(stdoutLine !== undefined);
  assert.equal(stdoutLine.endsWith('\n'), true);

  return JSON.parse(stdoutLine) as Record<string, any>;
}

function appendWhereClause(wheres: WhereClause[], args: WhereArguments): void {
  const [first, operator, value] = args;

  if (typeof first === 'function') {
    first(createExpressionBuilder());
    wheres.push({ column: APPLIED_LOCAL_REPLY_NOT_EXISTS_SENTINEL, operator: 'not exists', value: null });
    return;
  }

  if (typeof operator !== 'string') {
    throw new Error('missing fake where operator');
  }

  wheres.push({ column: first, operator, value });
}

function createExpressionBuilder() {
  return {
    selectFrom: (_table: string) => createExpressionSubqueryBuilder(),
    exists: (expression: unknown) => ({ exists: expression }),
    not: (expression: unknown) => ({ not: expression }),
  };
}

function createExpressionSubqueryBuilder() {
  const query = {
    select: (_columns: string | string[]) => query,
    whereRef: (_left: string, _operator: string, _right: string) => query,
    where: (_column: string, _operator: string, _value: unknown) => query,
  };

  return query;
}

function matchesWhereClauses<Row extends object>(row: Row, wheres: WhereClause[], messages: StoredMessage[]): boolean {
  return wheres.every((where) => {
    if (where.column === APPLIED_LOCAL_REPLY_NOT_EXISTS_SENTINEL) {
      return isPandaDeliveryIntentRow(row) && !hasAppliedLocalReply(row, messages);
    }

    const value = row[where.column as keyof Row];

    if (where.operator === '=') {
      return value === where.value;
    }

    if (where.operator === 'is') {
      return value === where.value;
    }

    if (where.operator === 'is not') {
      return value !== where.value;
    }

    throw new Error(`Unsupported where operator ${where.operator}`);
  });
}

function isPandaDeliveryIntentRow(row: object): row is StoredPandaDeliveryIntent {
  return 'route_handle_snapshot' in row && 'visitor_message_id' in row;
}

function hasAppliedLocalReply(
  intent: Pick<StoredPandaDeliveryIntent, 'id' | 'conversation_id'>,
  messages: StoredMessage[],
): boolean {
  return messages.some(
    (message) =>
      message.conversation_id === intent.conversation_id &&
      message.sender === 'agent' &&
      message.client_message_id === replyIdempotencyKeyForIntent(intent.id),
  );
}

function sortRows<Row extends object>(rows: Row[], orders: OrderClause[]): Row[] {
  return [...rows].sort((left, right) => {
    for (const order of orders) {
      const leftValue = comparableValue(left[order.column as keyof Row]);
      const rightValue = comparableValue(right[order.column as keyof Row]);

      if (leftValue < rightValue) {
        return order.direction === 'desc' ? 1 : -1;
      }

      if (leftValue > rightValue) {
        return order.direction === 'desc' ? -1 : 1;
      }
    }

    return 0;
  });
}

function comparableValue(value: unknown): string | number {
  return value instanceof Date ? value.toISOString() : typeof value === 'number' ? value : String(value);
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
