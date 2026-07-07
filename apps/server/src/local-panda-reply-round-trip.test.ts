import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import type { DatabaseClient, MessageSender, PandaDeliveryIntentStatus } from './db.ts';
import { runLocalPandaReplyRoundTripCli } from './local-panda-reply-round-trip-cli.ts';
import {
  runNextLocalPandaReplyRoundTrip,
  type LocalPandaReplyRoundTripMetadata,
  type LocalPandaReplyRoundTripResult,
} from './local-panda-reply-round-trip.ts';

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

const NOW = new Date('2026-01-01T00:00:00.000Z');
const CLAIMED_AND_REPLY_AT = new Date('2026-01-01T00:10:00.000Z');
const VISITOR_MESSAGE_CREATED_AT = new Date('2026-01-01T00:05:00.000Z');
const PUBLIC_FAKE_REPLY_CREATED_AT = new Date('2026-01-01T00:06:00.000Z');
const ROUND_TRIP_KIND = 'local-panda-one-shot-deterministic-fake-reply-round-trip';
const ROUND_TRIP_MODE = 'local-only-no-network-deterministic-fake-reply';
const REPLY_IDEMPOTENCY_KEY = 'local-panda-reply-v1:intent-1';
const roundTripSource = await readFile(new URL('./local-panda-reply-round-trip.ts', import.meta.url), 'utf8');
const roundTripCliSource = await readFile(new URL('./local-panda-reply-round-trip-cli.ts', import.meta.url), 'utf8');
const appSource = await readFile(new URL('./app.ts', import.meta.url), 'utf8');
const visitorMessageSource = await readFile(new URL('./visitor-message.ts', import.meta.url), 'utf8');
const serverPackageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8');
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
      where: (column: string, operator: string, value: unknown) => {
        wheres.push({ column, operator, value });
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
          return conversations.find((row) => matchesWhereClauses(row, wheres));
        }

        if (table === 'panda_delivery_intents') {
          const rows = sortRows(intents.filter((row) => matchesWhereClauses(row, wheres)), orders);
          return limit === undefined ? rows[0] : rows.slice(0, limit)[0];
        }

        if (table === 'messages') {
          const rows = sortRows(messages.filter((row) => matchesWhereClauses(row, wheres)), orders);
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
        const row = intents.find((intent) => matchesWhereClauses(intent, wheres));

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

test('runNextLocalPandaReplyRoundTrip claims one intent and inserts a deterministic local fake agent reply', async () => {
  const fake = createFakeDatabase({
    messages: [visitorMessageRow({ body: 'Visitor body that must not be echoed' })],
  });

  const result = await runNextLocalPandaReplyRoundTrip(fake.database, { now: CLAIMED_AND_REPLY_AT });

  assert.equal(result.completed, true);

  if (!result.completed) {
    assert.fail('expected completed round trip');
  }

  assertRoundTripEnvelope(result);
  assert.equal(result.metadata.stateMutation, 'claims-one-intent-and-inserts-or-replays-one-local-agent-message');
  assert.equal(result.metadata.network, 'no-network');
  assert.equal(result.metadata.pandaCall, 'not-attempted');
  assert.equal(result.metadata.gatewayCall, 'not-attempted');
  assert.equal(result.metadata.externalCliCall, 'not-attempted');
  assert.equal(result.metadata.childProcess, 'not-used');
  assert.equal(result.dispatchPayload.intent.status, 'claimed');
  assert.equal(result.dispatchPayload.intent.claimedAt, CLAIMED_AND_REPLY_AT.toISOString());
  assert.equal(result.syntheticFakeReplyIngressPayload.reply.text, deterministicReplyForIntent('intent-1'));
  assert.match(result.syntheticFakeReplyIngressPayload.reply.text, /Deterministic local fake reply/);
  assert.match(result.syntheticFakeReplyIngressPayload.reply.text, /No Panda, Gateway, external CLI, child process, or network call was attempted/);
  assert.equal(result.syntheticFakeReplyIngressPayload.reply.text.includes('Visitor body that must not be echoed'), false);
  assert.deepEqual(result.applyResult, {
    applied: true,
    inserted: true,
    message: {
      id: 'message-2',
      conversationId: 'conversation-1',
      seq: 2,
      sender: 'agent',
      clientMessageId: REPLY_IDEMPOTENCY_KEY,
      body: deterministicReplyForIntent('intent-1'),
      createdAt: CLAIMED_AND_REPLY_AT,
    },
  });
  assert.deepEqual(fake.messageInserts, [
    {
      conversation_id: 'conversation-1',
      seq: 2,
      sender: 'agent',
      client_message_id: REPLY_IDEMPOTENCY_KEY,
      body: deterministicReplyForIntent('intent-1'),
      created_at: CLAIMED_AND_REPLY_AT,
    },
  ]);
  assert.equal(fake.intents[0]?.status, 'claimed');
  assert.equal(fake.intents[0]?.claimed_at, CLAIMED_AND_REPLY_AT);
});

test('runNextLocalPandaReplyRoundTrip replays an existing matching local fake reply idempotently', async () => {
  const existingLocalReply = messageRow({
    id: 'existing-local-reply',
    seq: 2,
    sender: 'agent',
    client_message_id: REPLY_IDEMPOTENCY_KEY,
    body: deterministicReplyForIntent('intent-1'),
    created_at: CLAIMED_AND_REPLY_AT,
  });
  const fake = createFakeDatabase({ messages: [visitorMessageRow(), existingLocalReply] });

  const result = await runNextLocalPandaReplyRoundTrip(fake.database, { now: new Date('2026-01-01T00:20:00.000Z') });

  assert.equal(result.completed, true);

  if (!result.completed) {
    assert.fail('expected completed round trip');
  }

  assert.deepEqual(result.applyResult, {
    applied: true,
    inserted: false,
    message: {
      id: 'existing-local-reply',
      conversationId: 'conversation-1',
      seq: 2,
      sender: 'agent',
      clientMessageId: REPLY_IDEMPOTENCY_KEY,
      body: deterministicReplyForIntent('intent-1'),
      createdAt: CLAIMED_AND_REPLY_AT,
    },
  });
  assert.deepEqual(fake.messageInserts, []);
  assert.equal(fake.messages.filter((message) => message.client_message_id === REPLY_IDEMPOTENCY_KEY).length, 1);
});

test('runNextLocalPandaReplyRoundTrip preserves the route-created public fake reply and adds a separate local reply row', async () => {
  const routeCreatedFakeReply = messageRow({
    id: 'route-created-fake-reply',
    seq: 2,
    sender: 'agent',
    client_message_id: null,
    body: 'Thanks for trying the local Panda chat widget demo. This is a fake V1 reply, but your message was received.',
    created_at: PUBLIC_FAKE_REPLY_CREATED_AT,
  });
  const fake = createFakeDatabase({ messages: [visitorMessageRow(), routeCreatedFakeReply] });

  const result = await runNextLocalPandaReplyRoundTrip(fake.database, { now: CLAIMED_AND_REPLY_AT });

  assert.equal(result.completed, true);

  if (!result.completed) {
    assert.fail('expected completed round trip');
  }

  const agentMessages = fake.messages.filter((message) => message.sender === 'agent');
  const preservedPublicFakeReply = agentMessages.find((message) => message.id === 'route-created-fake-reply');
  const localRoundTripReply = agentMessages.find((message) => message.client_message_id === REPLY_IDEMPOTENCY_KEY);

  assert.equal(agentMessages.length, 2);
  assert.deepEqual(preservedPublicFakeReply, routeCreatedFakeReply);
  assert.deepEqual(localRoundTripReply, {
    id: 'message-3',
    conversation_id: 'conversation-1',
    seq: 3,
    sender: 'agent',
    client_message_id: REPLY_IDEMPOTENCY_KEY,
    body: result.syntheticFakeReplyIngressPayload.reply.body,
    created_at: CLAIMED_AND_REPLY_AT,
  });
  assert.equal(result.metadata.publicFakeReplyReplacement, 'not-attempted');
});

test('runNextLocalPandaReplyRoundTrip returns a controlled dispatch failure without building or applying a reply', async () => {
  const fake = createFakeDatabase({ intents: [] });

  const result = await runNextLocalPandaReplyRoundTrip(fake.database, { now: CLAIMED_AND_REPLY_AT });

  assert.deepEqual(result, {
    ...roundTripBase(),
    completed: false,
    failedStep: 'dispatch_prepare',
    reason: 'no_queued_intent',
  });
  assert.deepEqual(fake.updates, []);
  assert.deepEqual(fake.messageInserts, []);
  assert.equal(fake.selects.some((select) => select.table === 'conversations'), false);
  assert.equal(fake.selects.some((select) => select.table === 'messages'), false);
});

test('runNextLocalPandaReplyRoundTrip returns a controlled apply failure after the intent is claimed', async () => {
  const fake = createFakeDatabase({ conversations: [] });

  const result = await runNextLocalPandaReplyRoundTrip(fake.database, { now: CLAIMED_AND_REPLY_AT });

  assert.equal(result.completed, false);

  if (result.completed || result.failedStep !== 'apply_reply_ingress') {
    assert.fail('expected apply_reply_ingress failure');
  }

  assertRoundTripEnvelope(result);
  assert.equal(result.reason, 'conversation_not_found');
  assert.deepEqual(result.applyResult, { applied: false, reason: 'conversation_not_found' });
  assert.equal(result.dispatchPayload.correlationIds.intentId, 'intent-1');
  assert.equal(result.syntheticFakeReplyIngressPayload.reply.text, deterministicReplyForIntent('intent-1'));
  assert.equal(fake.intents[0]?.status, 'claimed');
  assert.equal(fake.intents[0]?.claimed_at, CLAIMED_AND_REPLY_AT);
  assert.deepEqual(fake.messageInserts, []);
});

test('runNextLocalPandaReplyRoundTrip reply text is deterministic from the intent ID only', async () => {
  const first = await runNextLocalPandaReplyRoundTrip(
    createFakeDatabase({ messages: [visitorMessageRow({ body: 'first visitor body with private details' })] }).database,
    { now: CLAIMED_AND_REPLY_AT },
  );
  const sameIntentDifferentBody = await runNextLocalPandaReplyRoundTrip(
    createFakeDatabase({ messages: [visitorMessageRow({ body: 'second visitor body with different private details' })] })
      .database,
    { now: CLAIMED_AND_REPLY_AT },
  );
  const differentIntent = await runNextLocalPandaReplyRoundTrip(
    createFakeDatabase({ intents: [intentRow({ id: 'intent-2' })], messages: [visitorMessageRow()] }).database,
    { now: CLAIMED_AND_REPLY_AT },
  );

  if (!first.completed || !sameIntentDifferentBody.completed || !differentIntent.completed) {
    assert.fail('expected all deterministic reply examples to complete');
  }

  assert.equal(first.syntheticFakeReplyIngressPayload.reply.text, sameIntentDifferentBody.syntheticFakeReplyIngressPayload.reply.text);
  assert.notEqual(first.syntheticFakeReplyIngressPayload.reply.text, differentIntent.syntheticFakeReplyIngressPayload.reply.text);
  assert.equal(first.syntheticFakeReplyIngressPayload.reply.text.includes('first visitor body'), false);
  assert.equal(sameIntentDifferentBody.syntheticFakeReplyIngressPayload.reply.text.includes('second visitor body'), false);
  assert.equal(differentIntent.syntheticFakeReplyIngressPayload.reply.text, deterministicReplyForIntent('intent-2'));
});

test('runLocalPandaReplyRoundTripCli prints JSON and closes the database on success and controlled failure', async () => {
  const successResult = await runNextLocalPandaReplyRoundTrip(createFakeDatabase().database, {
    now: CLAIMED_AND_REPLY_AT,
  });
  const failureResult: LocalPandaReplyRoundTripResult = {
    ...roundTripBase(),
    completed: false,
    failedStep: 'dispatch_prepare',
    reason: 'no_queued_intent',
  };

  for (const result of [successResult, failureResult]) {
    const database = {} as DatabaseClient;
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCodes: number[] = [];
    let closedDatabase: DatabaseClient | undefined;

    await runLocalPandaReplyRoundTripCli({
      loadDatabaseConfig: () => ({ url: 'postgresql://user:pass@127.0.0.1:5432/widget' }),
      createDatabase: (config) => {
        assert.equal(config.url, 'postgresql://user:pass@127.0.0.1:5432/widget');

        return database;
      },
      runNextLocalPandaReplyRoundTrip: async (client) => {
        assert.equal(client, database);

        return result;
      },
      closeDatabase: async (client) => {
        closedDatabase = client;
      },
      stdout: { write: (chunk) => stdout.push(chunk) },
      stderr: { write: (chunk) => stderr.push(chunk) },
      setExitCode: (exitCode) => exitCodes.push(exitCode),
    });

    assert.equal(closedDatabase, database);
    assert.deepEqual(stdout, [`${JSON.stringify(result, null, 2)}\n`]);
    assert.deepEqual(stderr, []);
    assert.deepEqual(exitCodes, []);
  }
});

test('runLocalPandaReplyRoundTripCli writes safe stderr and exit 1 for unexpected errors', async () => {
  const database = {} as DatabaseClient;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  let closedDatabase: DatabaseClient | undefined;

  await runLocalPandaReplyRoundTripCli({
    loadDatabaseConfig: () => ({ url: 'postgresql://user:super-secret@127.0.0.1:5432/widget' }),
    createDatabase: () => database,
    runNextLocalPandaReplyRoundTrip: async () => {
      throw new Error('database refused postgresql://user:super-secret@127.0.0.1:5432/widget');
    },
    closeDatabase: async (client) => {
      closedDatabase = client;
    },
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
    setExitCode: (exitCode) => exitCodes.push(exitCode),
  });

  assert.equal(closedDatabase, database);
  assert.deepEqual(stdout, []);
  assert.deepEqual(exitCodes, [1]);
  assert.equal(stderr[0], 'failed to run local Panda deterministic fake reply round trip\n');
  assert.deepEqual(JSON.parse(stderr[1] ?? '{}'), {
    name: 'Error',
    message: 'database refused postgresql://user:[redacted]@127.0.0.1:5432/widget',
  });
  assert.equal(stderr.join('').includes('super-secret'), false);
});

test('local reply round trip wiring stays server CLI-only with no network, worker, public route, frontend, or status expansion', () => {
  const serverPackage = JSON.parse(serverPackageSource) as { scripts?: Record<string, string> };
  const combinedRoundTripSource = `${roundTripSource}\n${roundTripCliSource}`;
  const combinedFrontendSource = `${consoleSource}\n${widgetUiSource}`;

  assert.match(roundTripSource, /prepareNextLocalPandaDispatchDryRun/);
  assert.match(roundTripSource, /buildLocalPandaReplyIngressPayloadV1/);
  assert.match(roundTripSource, /applyLocalPandaReplyIngressPayloadV1/);
  assert.equal(
    serverPackage.scripts?.['local-panda:reply-round-trip'],
    'node src/local-panda-reply-round-trip-cli.ts',
  );
  assert.doesNotMatch(
    appSource,
    /local-panda-reply-round-trip|runNextLocalPandaReplyRoundTrip|runLocalPandaReplyRoundTripCli|applyLocalPandaReplyIngressPayloadV1/,
  );
  assert.doesNotMatch(
    visitorMessageSource,
    /local-panda-reply-round-trip|runNextLocalPandaReplyRoundTrip|runLocalPandaReplyRoundTripCli|applyLocalPandaReplyIngressPayloadV1/,
  );
  assert.doesNotMatch(
    combinedFrontendSource,
    /local-panda-reply-round-trip|runNextLocalPandaReplyRoundTrip|runLocalPandaReplyRoundTripCli|applyLocalPandaReplyIngressPayloadV1|LocalPandaReplyRoundTripResult/,
  );
  assert.doesNotMatch(
    combinedRoundTripSource,
    /fetch\s*\(|WebSocket|EventSource|node:http|node:https|node:child_process|child_process|spawn\s*\(|exec\s*\(|setTimeout\s*\(|setInterval\s*\(|Worker\s*\(|dispatcher|daemon|retry|dead-letter|reply-ingestion|status:\s*'sent'|status:\s*'delivered'|status:\s*'failed'|status:\s*'replied'|sent_at|delivered_at|failed_at|replied_at/i,
  );
  assert.doesNotMatch(
    combinedRoundTripSource,
    /panda\s+(?:a2a|send|gateway)|gateway\s+(?:url|token|request|response|dispatch)/i,
  );
});

function assertRoundTripEnvelope(result: LocalPandaReplyRoundTripResult): void {
  assert.equal(result.kind, ROUND_TRIP_KIND);
  assert.equal(result.mode, ROUND_TRIP_MODE);
  assert.deepEqual(result.metadata, expectedMetadata());
  assert.equal(
    JSON.stringify({ kind: result.kind, mode: result.mode, metadata: result.metadata }).includes('no-state-mutation'),
    false,
  );
}

function roundTripBase(): Pick<LocalPandaReplyRoundTripResult, 'kind' | 'mode' | 'metadata'> {
  return {
    kind: ROUND_TRIP_KIND,
    mode: ROUND_TRIP_MODE,
    metadata: expectedMetadata(),
  };
}

function expectedMetadata(): LocalPandaReplyRoundTripMetadata {
  return {
    locality: 'local-only',
    network: 'no-network',
    pandaCall: 'not-attempted',
    gatewayCall: 'not-attempted',
    externalCliCall: 'not-attempted',
    childProcess: 'not-used',
    replySource: 'deterministic-local-fake-reply',
    stateMutation: 'claims-one-intent-and-inserts-or-replays-one-local-agent-message',
    publicFakeReplyReplacement: 'not-attempted',
    postClaimFailure: 'intent-may-remain-claimed-after-dispatch-build-or-apply-failure',
    rollback: 'not-attempted',
    statusLifecycleExpansion: 'not-attempted',
  };
}

function deterministicReplyForIntent(intentId: string): string {
  return `Deterministic local fake reply for intent ${intentId}. No Panda, Gateway, external CLI, child process, or network call was attempted.`;
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

function matchesWhereClauses<Row extends object>(row: Row, wheres: WhereClause[]): boolean {
  return wheres.every((where) => {
    const value = row[where.column as keyof Row];

    if (where.operator === '=') {
      return value === where.value;
    }

    throw new Error(`Unsupported where operator ${where.operator}`);
  });
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
