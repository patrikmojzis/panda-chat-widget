import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import type { DatabaseClient, MessageSender, PandaDeliveryIntentStatus } from './db.ts';
import {
  runLocalPandaReplyIngressApplyCli,
  type LocalPandaReplyIngressApplyCliDependencies,
} from './local-panda-reply-ingress-apply-cli.ts';
import {
  applyLocalPandaReplyIngressPayloadV1,
  type ApplyLocalPandaReplyIngressPayloadV1FailureReason,
  type ApplyLocalPandaReplyIngressPayloadV1Result,
} from './local-panda-reply-ingress-apply.ts';
import type {
  LocalPandaReplyIngressCorrelationIds,
  LocalPandaReplyIngressPayloadV1,
} from './local-panda-reply-ingress-payload.ts';

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
  limit: number | undefined;
};

type MessageInsertConflictTarget = {
  columns: string[];
  where: { column: string; operator: string; value: null } | null;
};

type FakeDatabaseOptions = {
  conversations?: StoredConversation[];
  intents?: StoredPandaDeliveryIntent[];
  messages?: StoredMessage[];
  messageInsertUniqueError?: boolean;
  agentInsertRaceMessage?: StoredMessage;
};

type FakeDatabase = {
  database: DatabaseClient;
  conversations: StoredConversation[];
  intents: StoredPandaDeliveryIntent[];
  messages: StoredMessage[];
  selects: SelectLog[];
  messageInserts: MessageInsertValues[];
  messageInsertConflictTargets: MessageInsertConflictTarget[];
  messageInsertConflictDoNothingCount: number;
  transactions: number;
};

const NOW = new Date('2026-01-01T00:00:00.000Z');
const CLAIMED_AT = new Date('2026-01-01T00:10:00.000Z');
const VISITOR_MESSAGE_CREATED_AT = new Date('2026-01-01T00:05:00.000Z');
const REPLY_CREATED_AT = new Date('2026-01-01T00:15:00.000Z');
const REPLY_BODY = 'Hello from the local Panda agent.';
const REPLY_IDEMPOTENCY_KEY = 'local-panda-reply-v1:intent-1';
const APPLY_CLI_KIND = 'local-panda-reply-ingress-apply';
const APPLY_CLI_MODE = 'local-only-stdin-reply-ingress-apply';
const applySource = await readFile(new URL('./local-panda-reply-ingress-apply.ts', import.meta.url), 'utf8');
const applyCliSource = await readFile(new URL('./local-panda-reply-ingress-apply-cli.ts', import.meta.url), 'utf8');
const appSource = await readFile(new URL('./app.ts', import.meta.url), 'utf8');
const visitorMessageSource = await readFile(new URL('./visitor-message.ts', import.meta.url), 'utf8');
const serverPackageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8');
const readmeSource = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
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

function createFakeDatabase(options: FakeDatabaseOptions = {}): FakeDatabase {
  const conversations = [...(options.conversations ?? [conversationRow()])];
  const intents = [...(options.intents ?? [intentRow()])];
  const messages = [...(options.messages ?? [visitorMessageRow()])];
  const selects: SelectLog[] = [];
  const messageInserts: MessageInsertValues[] = [];
  const messageInsertConflictTargets: MessageInsertConflictTarget[] = [];
  let messageInsertConflictDoNothingCount = 0;
  let transactions = 0;
  let agentInsertRaceMessage = options.agentInsertRaceMessage;

  function createSelectQuery(table: string) {
    let selectedColumns: string[] = [];
    const wheres: WhereClause[] = [];
    const orders: OrderClause[] = [];
    let forUpdate = false;
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
          limit,
        });

        if (table === 'conversations') {
          return conversations.find((row) => matchesWhereClauses(row, wheres));
        }

        if (table === 'panda_delivery_intents') {
          return intents.find((row) => matchesWhereClauses(row, wheres));
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

  function createMessageInsertQuery(table: string) {
    assert.equal(table, 'messages');
    let pendingValues: MessageInsertValues | undefined;
    let conflictTarget: MessageInsertConflictTarget | null = null;
    let doNothingOnConflict = false;

    const conflictBuilder = {
      where: (column: string, operator: string, value: null) => {
        if (!conflictTarget) {
          throw new Error('missing conflict target before where');
        }

        conflictTarget.where = { column, operator, value };
        return conflictBuilder;
      },
      doNothing: () => {
        doNothingOnConflict = true;
        messageInsertConflictDoNothingCount += 1;
        return query;
      },
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
        buildConflict({
          columns: (columns: string[]) => {
            conflictTarget = { columns, where: null };
            messageInsertConflictTargets.push(conflictTarget);
            return conflictBuilder;
          },
        });

        return query;
      },
      returning: () => query,
      executeTakeFirst: async () => {
        if (!pendingValues) {
          throw new Error('missing message insert values');
        }

        if (
          agentInsertRaceMessage &&
          agentInsertRaceMessage.conversation_id === pendingValues.conversation_id &&
          agentInsertRaceMessage.client_message_id === pendingValues.client_message_id
        ) {
          messages.push(agentInsertRaceMessage);
          agentInsertRaceMessage = undefined;
        }

        if (options.messageInsertUniqueError) {
          messageInserts.push(pendingValues);
          throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
        }

        const duplicateClientMessage = messages.find(
          (message) =>
            message.conversation_id === pendingValues?.conversation_id &&
            message.client_message_id === pendingValues?.client_message_id &&
            message.client_message_id !== null,
        );

        if (duplicateClientMessage) {
          assert.deepEqual(conflictTarget, {
            columns: ['conversation_id', 'client_message_id'],
            where: { column: 'client_message_id', operator: 'is not', value: null },
          });
          assert.equal(doNothingOnConflict, true);
          return undefined;
        }

        const duplicateSeq = messages.find(
          (message) =>
            message.conversation_id === pendingValues?.conversation_id && message.seq === pendingValues?.seq,
        );

        if (duplicateSeq) {
          messageInserts.push(pendingValues);
          throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
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
    insertInto: createMessageInsertQuery,
  } as unknown as DatabaseClient;

  return {
    database,
    conversations,
    intents,
    messages,
    selects,
    messageInserts,
    messageInsertConflictTargets,
    get messageInsertConflictDoNothingCount() {
      return messageInsertConflictDoNothingCount;
    },
    get transactions() {
      return transactions;
    },
  };
}

test('applyLocalPandaReplyIngressPayloadV1 inserts one agent message for a valid claimed intent', async () => {
  const fake = createFakeDatabase({
    messages: [
      visitorMessageRow(),
      messageRow({ id: 'system-message-1', seq: 2, sender: 'system', client_message_id: null, body: 'System note' }),
    ],
  });

  const result = await applyLocalPandaReplyIngressPayloadV1(fake.database, replyPayload(), { now: REPLY_CREATED_AT });

  assert.deepEqual(result, {
    applied: true,
    inserted: true,
    message: {
      id: 'message-3',
      conversationId: 'conversation-1',
      seq: 3,
      sender: 'agent',
      clientMessageId: REPLY_IDEMPOTENCY_KEY,
      body: REPLY_BODY,
      createdAt: REPLY_CREATED_AT,
    },
  });
  assert.deepEqual(fake.messageInserts, [
    {
      conversation_id: 'conversation-1',
      seq: 3,
      sender: 'agent',
      client_message_id: REPLY_IDEMPOTENCY_KEY,
      body: REPLY_BODY,
      created_at: REPLY_CREATED_AT,
    },
  ]);
  assert.equal(fake.transactions, 1);
  assert.equal(fake.messageInsertConflictDoNothingCount, 1);
  assert.deepEqual(fake.messageInsertConflictTargets, [
    {
      columns: ['conversation_id', 'client_message_id'],
      where: { column: 'client_message_id', operator: 'is not', value: null },
    },
  ]);
  assert.deepEqual(
    fake.selects.filter((select) => select.table === 'messages' && select.orders.length > 0),
    [
      {
        table: 'messages',
        selectedColumns: ['seq'],
        wheres: [{ column: 'conversation_id', operator: '=', value: 'conversation-1' }],
        orders: [{ column: 'seq', direction: 'desc' }],
        forUpdate: false,
        limit: 1,
      },
    ],
  );
});

test('applyLocalPandaReplyIngressPayloadV1 replays a matching agent idempotency row without allocating seq', async () => {
  const existingReply = messageRow({
    id: 'reply-message-1',
    seq: 2,
    sender: 'agent',
    client_message_id: REPLY_IDEMPOTENCY_KEY,
    body: REPLY_BODY,
    created_at: REPLY_CREATED_AT,
  });
  const fake = createFakeDatabase({ messages: [visitorMessageRow(), existingReply] });

  const result = await applyLocalPandaReplyIngressPayloadV1(fake.database, replyPayload(), {
    now: new Date('2026-01-01T00:30:00.000Z'),
  });

  assert.deepEqual(result, {
    applied: true,
    inserted: false,
    message: {
      id: 'reply-message-1',
      conversationId: 'conversation-1',
      seq: 2,
      sender: 'agent',
      clientMessageId: REPLY_IDEMPOTENCY_KEY,
      body: REPLY_BODY,
      createdAt: REPLY_CREATED_AT,
    },
  });
  assert.deepEqual(fake.messageInserts, []);
  assert.equal(fake.selects.some((select) => select.table === 'messages' && select.orders.length > 0), false);
});

test('applyLocalPandaReplyIngressPayloadV1 refuses idempotency rows that are not the same agent reply', async () => {
  const cases: Array<{ name: string; existingMessage: StoredMessage }> = [
    {
      name: 'same key used by a visitor message',
      existingMessage: messageRow({
        id: 'conflicting-visitor-message',
        seq: 2,
        sender: 'visitor',
        client_message_id: REPLY_IDEMPOTENCY_KEY,
        body: REPLY_BODY,
      }),
    },
    {
      name: 'same key used by a different agent body',
      existingMessage: messageRow({
        id: 'conflicting-agent-message',
        seq: 2,
        sender: 'agent',
        client_message_id: REPLY_IDEMPOTENCY_KEY,
        body: 'Different reply body',
      }),
    },
  ];

  for (const testCase of cases) {
    const fake = createFakeDatabase({ messages: [visitorMessageRow(), testCase.existingMessage] });

    assert.deepEqual(
      await applyLocalPandaReplyIngressPayloadV1(fake.database, replyPayload(), { now: REPLY_CREATED_AT }),
      { applied: false, reason: 'idempotency_conflict' },
      testCase.name,
    );
    assert.deepEqual(fake.messageInserts, [], testCase.name);
    assert.equal(
      fake.selects.some((select) => select.table === 'messages' && select.orders.length > 0),
      false,
      testCase.name,
    );
  }
});

test('applyLocalPandaReplyIngressPayloadV1 returns a controlled insert conflict for seq races', async () => {
  const fake = createFakeDatabase({ messageInsertUniqueError: true });

  assert.deepEqual(await applyLocalPandaReplyIngressPayloadV1(fake.database, replyPayload(), { now: REPLY_CREATED_AT }), {
    applied: false,
    reason: 'message_insert_conflict',
  });
  assert.equal(fake.messageInserts.length, 1);
  assert.equal(fake.messageInserts[0]?.seq, 2);
  assert.equal(
    fake.selects.filter(
      (select) =>
        select.table === 'messages' &&
        select.wheres.some((where) => where.column === 'client_message_id' && where.value === REPLY_IDEMPOTENCY_KEY),
    ).length,
    1,
  );
});

test('applyLocalPandaReplyIngressPayloadV1 replays a matching agent row created by a concurrent idempotency race', async () => {
  const raceReply = messageRow({
    id: 'reply-race',
    seq: 2,
    sender: 'agent',
    client_message_id: REPLY_IDEMPOTENCY_KEY,
    body: REPLY_BODY,
    created_at: REPLY_CREATED_AT,
  });
  const fake = createFakeDatabase({ agentInsertRaceMessage: raceReply });

  assert.deepEqual(await applyLocalPandaReplyIngressPayloadV1(fake.database, replyPayload(), { now: REPLY_CREATED_AT }), {
    applied: true,
    inserted: false,
    message: {
      id: 'reply-race',
      conversationId: 'conversation-1',
      seq: 2,
      sender: 'agent',
      clientMessageId: REPLY_IDEMPOTENCY_KEY,
      body: REPLY_BODY,
      createdAt: REPLY_CREATED_AT,
    },
  });
  assert.deepEqual(fake.messageInserts, []);
});

test('applyLocalPandaReplyIngressPayloadV1 validates the v1 payload contract before opening a transaction', async () => {
  const cases: Array<{ name: string; payload: unknown }> = [
    { name: 'wrong version', payload: { ...replyPayload(), version: 2 } },
    { name: 'wrong kind', payload: { ...replyPayload(), kind: 'local-panda-future-dispatch' } },
    {
      name: 'blank correlation id',
      payload: replyPayload({ correlationIds: { ...baseCorrelationIds, visitorMessageId: '   ' } }),
    },
    { name: 'invalid idempotency contract', payload: replyPayload({ idempotencyKey: 'wrong-key' }) },
    { name: 'blank reply body', payload: replyPayload({ reply: { body: '   ', text: '   ' } }) },
    { name: 'mismatched reply body and text', payload: replyPayload({ reply: { body: REPLY_BODY, text: 'Other text' } }) },
  ];

  for (const testCase of cases) {
    const fake = createFakeDatabase();

    assert.deepEqual(
      await applyLocalPandaReplyIngressPayloadV1(fake.database, testCase.payload as LocalPandaReplyIngressPayloadV1),
      { applied: false, reason: 'invalid_payload' },
      testCase.name,
    );
    assert.equal(fake.transactions, 0, testCase.name);
    assert.deepEqual(fake.selects, [], testCase.name);
    assert.deepEqual(fake.messageInserts, [], testCase.name);
  }
});

test('applyLocalPandaReplyIngressPayloadV1 returns precise DB-truth validation failures', async () => {
  const cases: Array<{
    name: string;
    options: FakeDatabaseOptions;
    reason: ApplyLocalPandaReplyIngressPayloadV1FailureReason;
  }> = [
    {
      name: 'missing conversation',
      options: { conversations: [] },
      reason: 'conversation_not_found',
    },
    {
      name: 'conversation correlation mismatch',
      options: { conversations: [conversationRow({ widget_id: 'other-widget' })] },
      reason: 'conversation_correlation_mismatch',
    },
    {
      name: 'missing intent',
      options: { intents: [] },
      reason: 'intent_not_found',
    },
    {
      name: 'unclaimed intent status',
      options: { intents: [intentRow({ status: 'queued', claimed_at: null })] },
      reason: 'intent_not_claimed',
    },
    {
      name: 'claimed intent missing claimed_at',
      options: { intents: [intentRow({ claimed_at: null })] },
      reason: 'intent_not_claimed',
    },
    {
      name: 'intent correlation mismatch',
      options: { intents: [intentRow({ visitor_session_id: 'other-visitor-session' })] },
      reason: 'intent_correlation_mismatch',
    },
    {
      name: 'missing visitor message',
      options: { messages: [] },
      reason: 'visitor_message_not_found',
    },
    {
      name: 'visitor message is not from visitor',
      options: { messages: [visitorMessageRow({ sender: 'agent', client_message_id: null })] },
      reason: 'visitor_message_not_visitor',
    },
    {
      name: 'visitor message correlation mismatch',
      options: { messages: [visitorMessageRow({ client_message_id: 'other-client-message' })] },
      reason: 'visitor_message_correlation_mismatch',
    },
  ];

  for (const testCase of cases) {
    const fake = createFakeDatabase(testCase.options);

    assert.deepEqual(
      await applyLocalPandaReplyIngressPayloadV1(fake.database, replyPayload(), { now: REPLY_CREATED_AT }),
      { applied: false, reason: testCase.reason },
      testCase.name,
    );
    assert.equal(fake.transactions, 1, testCase.name);
    assert.deepEqual(fake.messageInserts, [], testCase.name);
  }
});


test('runLocalPandaReplyIngressApplyCli applies a valid stdin payload and replays the same payload', async () => {
  const fake = createFakeDatabase();
  const firstRun = await runReplyIngressApplyCliWithDatabase({
    database: fake.database,
    input: JSON.stringify(replyPayload()),
  });
  const firstEnvelope = parseCliJsonObject(firstRun.stdout[0]);

  assertApplyCliBaseEnvelope(firstEnvelope);
  assert.equal(firstEnvelope.completed, true);
  assert.equal(firstEnvelope.parsed, true);
  assert.deepEqual(firstRun.stderr, []);
  assert.deepEqual(firstRun.exitCodes, []);
  assert.equal(firstRun.loadDatabaseConfigCount, 1);
  assert.equal(firstRun.createDatabaseCount, 1);
  assert.deepEqual(firstRun.closedDatabases, [fake.database]);

  const firstApplyResult = firstEnvelope.applyResult as Record<string, unknown>;
  assert.equal(firstApplyResult.applied, true);
  assert.equal(firstApplyResult.inserted, true);
  assert.equal(fake.messages.filter((message) => message.sender === 'agent').length, 1);
  assert.equal(fake.messages.find((message) => message.sender === 'agent')?.client_message_id, REPLY_IDEMPOTENCY_KEY);

  const secondRun = await runReplyIngressApplyCliWithDatabase({
    database: fake.database,
    input: JSON.stringify(replyPayload()),
  });
  const secondEnvelope = parseCliJsonObject(secondRun.stdout[0]);

  assertApplyCliBaseEnvelope(secondEnvelope);
  assert.equal(secondEnvelope.completed, true);
  assert.equal(secondEnvelope.parsed, true);
  assert.deepEqual(secondRun.stderr, []);
  assert.deepEqual(secondRun.exitCodes, []);
  assert.deepEqual(secondRun.closedDatabases, [fake.database]);

  const secondApplyResult = secondEnvelope.applyResult as Record<string, unknown>;
  assert.equal(secondApplyResult.applied, true);
  assert.equal(secondApplyResult.inserted, false);
  assert.equal(fake.messages.filter((message) => message.sender === 'agent').length, 1);
});

test('runLocalPandaReplyIngressApplyCli reports controlled idempotency conflicts with exit 0', async () => {
  const fake = createFakeDatabase({
    messages: [
      visitorMessageRow(),
      messageRow({
        id: 'conflicting-agent-message',
        seq: 2,
        sender: 'agent',
        client_message_id: REPLY_IDEMPOTENCY_KEY,
        body: 'Different reply body',
      }),
    ],
  });

  const run = await runReplyIngressApplyCliWithDatabase({
    database: fake.database,
    input: JSON.stringify(replyPayload()),
  });
  const envelope = parseCliJsonObject(run.stdout[0]);

  assertApplyCliBaseEnvelope(envelope);
  assert.equal(envelope.completed, false);
  assert.equal(envelope.parsed, true);
  assert.equal(envelope.failedStep, 'apply_reply_ingress');
  assert.equal(envelope.reason, 'idempotency_conflict');
  assert.deepEqual(envelope.applyResult, { applied: false, reason: 'idempotency_conflict' });
  assert.deepEqual(run.stderr, []);
  assert.deepEqual(run.exitCodes, []);
  assert.deepEqual(run.closedDatabases, [fake.database]);
});

test('runLocalPandaReplyIngressApplyCli delegates parseable wrong v1 objects to the helper', async () => {
  const fake = createFakeDatabase();

  const run = await runReplyIngressApplyCliWithDatabase({
    database: fake.database,
    input: JSON.stringify({
      version: 1,
      kind: 'local-panda-reply-ingress',
      idempotencyKey: 'wrong-key',
    }),
  });
  const envelope = parseCliJsonObject(run.stdout[0]);

  assertApplyCliBaseEnvelope(envelope);
  assert.equal(envelope.completed, false);
  assert.equal(envelope.parsed, true);
  assert.equal(envelope.failedStep, 'apply_reply_ingress');
  assert.equal(envelope.reason, 'invalid_payload');
  assert.deepEqual(envelope.applyResult, { applied: false, reason: 'invalid_payload' });
  assert.equal(fake.transactions, 0);
  assert.deepEqual(run.stderr, []);
  assert.deepEqual(run.exitCodes, []);
  assert.equal(run.loadDatabaseConfigCount, 1);
  assert.equal(run.createDatabaseCount, 1);
  assert.deepEqual(run.closedDatabases, [fake.database]);
});

test('runLocalPandaReplyIngressApplyCli rejects stdin parse failures before opening the database', async () => {
  const cases: Array<{ name: string; input: string; reason: string }> = [
    { name: 'empty stdin', input: '', reason: 'empty_stdin' },
    { name: 'whitespace stdin', input: '   \n\t', reason: 'empty_stdin' },
    { name: 'malformed JSON', input: '{', reason: 'malformed_json' },
    { name: 'null JSON', input: 'null', reason: 'json_value_not_object' },
    { name: 'array JSON', input: '[]', reason: 'json_value_not_object' },
    { name: 'scalar string JSON', input: '"reply"', reason: 'json_value_not_object' },
    { name: 'scalar boolean JSON', input: 'true', reason: 'json_value_not_object' },
  ];

  for (const testCase of cases) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCodes: number[] = [];
    let loadDatabaseConfigCount = 0;
    let createDatabaseCount = 0;
    let applyCount = 0;

    await runLocalPandaReplyIngressApplyCli({
      readStdin: async () => testCase.input,
      loadDatabaseConfig: () => {
        loadDatabaseConfigCount += 1;
        throw new Error('database config must not be loaded for parse failures');
      },
      createDatabase: () => {
        createDatabaseCount += 1;
        throw new Error('database must not be opened for parse failures');
      },
      applyLocalPandaReplyIngressPayloadV1: async () => {
        applyCount += 1;
        throw new Error('helper must not be called for parse failures');
      },
      closeDatabase: async () => {
        throw new Error('database must not be closed when it was never opened');
      },
      stdout: { write: (chunk) => stdout.push(chunk) },
      stderr: { write: (chunk) => stderr.push(chunk) },
      setExitCode: (exitCode) => exitCodes.push(exitCode),
    });

    const envelope = parseCliJsonObject(stdout[0]);
    assertApplyCliBaseEnvelope(envelope);
    assert.equal(envelope.completed, false, testCase.name);
    assert.equal(envelope.parsed, false, testCase.name);
    assert.equal(envelope.failedStep, 'stdin_parse', testCase.name);
    assert.equal(envelope.reason, testCase.reason, testCase.name);
    assert.deepEqual(stderr, [], testCase.name);
    assert.deepEqual(exitCodes, [1], testCase.name);
    assert.equal(loadDatabaseConfigCount, 0, testCase.name);
    assert.equal(createDatabaseCount, 0, testCase.name);
    assert.equal(applyCount, 0, testCase.name);
  }
});

test('runLocalPandaReplyIngressApplyCli writes safe stderr, exits 1, and closes DB on unexpected errors', async () => {
  const database = {} as DatabaseClient;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  let closedDatabase: DatabaseClient | undefined;

  await runLocalPandaReplyIngressApplyCli({
    readStdin: async () => JSON.stringify(replyPayload()),
    loadDatabaseConfig: () => ({ url: 'postgresql://user:super-secret@127.0.0.1:5432/widget' }),
    createDatabase: () => database,
    applyLocalPandaReplyIngressPayloadV1: async () => {
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
  assert.equal(stderr[0], 'failed to apply local Panda reply ingress payload from stdin\n');
  assert.deepEqual(JSON.parse(stderr[1] ?? '{}'), {
    name: 'Error',
    message: 'database refused postgresql://user:[redacted]@127.0.0.1:5432/widget',
  });
  assert.equal(stderr.join('').includes('super-secret'), false);
  assert.equal(stderr.join('').includes('\n    at '), false);
});

test('local reply ingress apply helper has no route, CLI, network, worker, fake reply, SSE, or status expansion wiring', () => {
  assert.match(applySource, /transaction\(\)\.execute\(async \(transaction\) =>/);
  assert.match(applySource, /selectFrom\('conversations'\)[\s\S]*forUpdate\(\)/);
  assert.match(applySource, /selectFrom\('panda_delivery_intents'\)[\s\S]*forUpdate\(\)/);
  assert.match(applySource, /insertInto\('messages'\)/);
  assert.match(applySource, /where\('client_message_id', '=', input\.clientMessageId\)/);
  assert.match(applySource, /isUniqueViolation/);
  assert.doesNotMatch(
    applySource,
    /Fastify|app\.(get|post|put|patch|delete)|\bCLI\b|fetch\s*\(|node:child_process|child_process|setTimeout\s*\(|setInterval\s*\(|Worker\s*\(|EventSource|WebSocket|Server-Sent|SSE|fake-responder|createFakeResponderReply|frontend|retry|dead-letter|status:\s*'sent'|status:\s*'delivered'|status:\s*'failed'|status:\s*'replied'|sent_at|delivered_at|failed_at|replied_at/i,
  );
});

test('local reply ingress apply CLI stays server-only without public route, frontend, network, worker, or status expansion', () => {
  const serverPackage = JSON.parse(serverPackageSource) as { scripts?: Record<string, string> };
  const combinedApplySource = `${applySource}\n${applyCliSource}`;
  const combinedFrontendSource = `${consoleSource}\n${widgetUiSource}`;

  assert.equal(
    serverPackage.scripts?.['local-panda:reply-ingress-apply'],
    'node dist/local-panda-reply-ingress-apply-cli.js',
  );
  assert.match(
    readmeSource,
    /cat reply-ingress\.json \| pnpm --silent --filter @panda-chat-widget\/server local-panda:reply-ingress-apply/,
  );
  assert.doesNotMatch(
    readmeSource,
    /cat reply-ingress\.json \| pnpm --filter @panda-chat-widget\/server local-panda:reply-ingress-apply/,
  );
  assert.doesNotMatch(
    appSource,
    /local-panda-reply-ingress-apply|runLocalPandaReplyIngressApplyCli|applyLocalPandaReplyIngressPayloadV1/,
  );
  assert.doesNotMatch(
    visitorMessageSource,
    /local-panda-reply-ingress-apply|runLocalPandaReplyIngressApplyCli|applyLocalPandaReplyIngressPayloadV1/,
  );
  assert.doesNotMatch(
    combinedFrontendSource,
    /local-panda-reply-ingress-apply|runLocalPandaReplyIngressApplyCli|applyLocalPandaReplyIngressPayloadV1|LocalPandaReplyIngressApplyCliResult/,
  );
  assert.doesNotMatch(
    combinedApplySource,
    /fetch\s*\(|WebSocket|EventSource|node:http|node:https|node:child_process|child_process|spawn\s*\(|exec\s*\(|setTimeout\s*\(|setInterval\s*\(|Worker\s*\(|dispatcher|daemon|retry|dead-letter|\.schema|createTable|alterTable|addColumn|dropTable|dropColumn|status:\s*'sent'|status:\s*'delivered'|status:\s*'failed'|status:\s*'replied'|sent_at|delivered_at|failed_at|replied_at/i,
  );
  assert.doesNotMatch(
    combinedApplySource,
    /panda\s+(?:a2a|send|gateway)|gateway\s+(?:url|token|request|response|dispatch)/i,
  );
});


type ApplyCliDatabaseRunOptions = {
  database: DatabaseClient;
  input: string;
  applyLocalPandaReplyIngressPayloadV1?: (
    database: DatabaseClient,
    payload: LocalPandaReplyIngressPayloadV1,
  ) => Promise<ApplyLocalPandaReplyIngressPayloadV1Result>;
};

type ApplyCliDatabaseRun = {
  stdout: string[];
  stderr: string[];
  exitCodes: number[];
  closedDatabases: DatabaseClient[];
  loadDatabaseConfigCount: number;
  createDatabaseCount: number;
};

async function runReplyIngressApplyCliWithDatabase(
  options: ApplyCliDatabaseRunOptions,
): Promise<ApplyCliDatabaseRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  const closedDatabases: DatabaseClient[] = [];
  let loadDatabaseConfigCount = 0;
  let createDatabaseCount = 0;
  const dependencies: LocalPandaReplyIngressApplyCliDependencies = {
    readStdin: async () => options.input,
    loadDatabaseConfig: () => {
      loadDatabaseConfigCount += 1;
      return { url: 'postgresql://user:pass@127.0.0.1:5432/widget' };
    },
    createDatabase: (config) => {
      createDatabaseCount += 1;
      assert.equal(config.url, 'postgresql://user:pass@127.0.0.1:5432/widget');

      return options.database;
    },
    closeDatabase: async (database) => {
      closedDatabases.push(database);
    },
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
    setExitCode: (exitCode) => exitCodes.push(exitCode),
  };

  if (options.applyLocalPandaReplyIngressPayloadV1) {
    dependencies.applyLocalPandaReplyIngressPayloadV1 = options.applyLocalPandaReplyIngressPayloadV1;
  }

  await runLocalPandaReplyIngressApplyCli(dependencies);

  return {
    stdout,
    stderr,
    exitCodes,
    closedDatabases,
    loadDatabaseConfigCount,
    createDatabaseCount,
  };
}

function parseCliJsonObject(chunk: string | undefined): Record<string, unknown> {
  if (typeof chunk !== 'string') {
    assert.fail('expected one JSON stdout chunk');
  }

  const parsed = JSON.parse(chunk) as unknown;

  assert.equal(typeof parsed, 'object');
  assert.notEqual(parsed, null);
  assert.equal(Array.isArray(parsed), false);

  return parsed as Record<string, unknown>;
}

function assertApplyCliBaseEnvelope(envelope: Record<string, unknown>): void {
  assert.equal(envelope.kind, APPLY_CLI_KIND);
  assert.equal(envelope.mode, APPLY_CLI_MODE);
  assert.deepEqual(envelope.metadata, expectedApplyCliMetadata());
}

function expectedApplyCliMetadata(): Record<string, string> {
  return {
    locality: 'local-only',
    input: 'stdin-json-object',
    network: 'no-network',
    pandaCall: 'not-attempted',
    gatewayCall: 'not-attempted',
    externalCliCall: 'not-attempted',
    childProcess: 'not-used',
    publicRoute: 'not-created',
    worker: 'not-created',
    statusLifecycleExpansion: 'not-attempted',
    stateMutation: 'local-db-apply-or-replay-via-existing-helper',
  };
}

function replyPayload(
  overrides: Partial<Omit<LocalPandaReplyIngressPayloadV1, 'version' | 'kind' | 'metadata'>> = {},
): LocalPandaReplyIngressPayloadV1 {
  const correlationIds = overrides.correlationIds ?? baseCorrelationIds;
  const reply = overrides.reply ?? { body: REPLY_BODY, text: REPLY_BODY };

  return {
    version: 1,
    kind: 'local-panda-reply-ingress',
    idempotencyKey: overrides.idempotencyKey ?? `local-panda-reply-v1:${correlationIds.intentId}`,
    correlationIds,
    reply,
    metadata: {
      locality: 'local-only',
      ingress: 'future-reply',
      contract: 'contract-only',
      network: 'no-network',
      stateMutation: 'no-state-mutation',
      replyInsertion: 'no-reply-insertion',
      replyCardinality: 'one-reply-per-claimed-intent-v1',
    },
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
    route_handle_snapshot: 'panda:workspace/alpha',
    status: 'claimed',
    claimed_at: CLAIMED_AT,
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

function sortRows(rows: StoredMessage[], orders: OrderClause[]): StoredMessage[] {
  return [...rows].sort((left, right) => {
    for (const order of orders) {
      const leftValue = comparableValue(left[order.column as keyof StoredMessage]);
      const rightValue = comparableValue(right[order.column as keyof StoredMessage]);

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

async function readSourceTree(directoryUrl: URL): Promise<string> {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const chunks: string[] = [];

  for (const entry of entries) {
    const entryUrl = new URL(entry.name, directoryUrl);

    if (entry.isDirectory()) {
      chunks.push(await readSourceTree(new URL(`${entry.name}/`, directoryUrl)));
      continue;
    }

    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      chunks.push(await readFile(entryUrl, 'utf8'));
    }
  }

  return chunks.join('\n');
}
