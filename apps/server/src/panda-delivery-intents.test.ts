import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { DatabaseClient, MessageSender, PandaDeliveryIntentStatus } from './db.ts';
import { prepareNextLocalPandaDispatchDryRun } from './local-panda-dispatch-dry-run.ts';
import { runLocalPandaDispatchDryRunCli } from './local-panda-dispatch-dry-run-cli.ts';
import { buildLocalPandaDispatchPayloadV1 } from './local-panda-dispatch-payload.ts';
import type { ClaimedPandaDeliveryIntent } from './panda-delivery-intents.ts';
import {
  claimNextQueuedPandaDeliveryIntent,
  claimQueuedPandaDeliveryIntentById,
  recordPandaDeliveryIntent,
} from './panda-delivery-intents.ts';

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

type PandaDeliveryIntentInsertValues = Omit<StoredPandaDeliveryIntent, 'id' | 'claimed_at'> & {
  claimed_at?: Date | null;
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
  updates: Record<string, unknown>;
  wheres: WhereClause[];
  returningColumns: string[];
};

type FakeDatabaseOptions = {
  failClaimUpdate?: boolean;
  messages?: StoredMessage[];
};

type FakeDatabase = {
  database: DatabaseClient;
  conflictColumns: string[];
  insertAttempts: PandaDeliveryIntentInsertValues[];
  intents: StoredPandaDeliveryIntent[];
  messages: StoredMessage[];
  selects: SelectLog[];
  updates: UpdateLog[];
  transactions: number;
};

const NOW = new Date('2026-01-01T00:00:00.000Z');
const CLAIMED_AT = new Date('2026-01-01T00:10:00.000Z');
const MESSAGE_CREATED_AT = new Date('2026-01-01T00:05:00.000Z');
const helperSource = await readFile(new URL('./panda-delivery-intents.ts', import.meta.url), 'utf8');
const dryRunSource = await readFile(new URL('./local-panda-dispatch-dry-run.ts', import.meta.url), 'utf8');
const dryRunCliSource = await readFile(new URL('./local-panda-dispatch-dry-run-cli.ts', import.meta.url), 'utf8');
const payloadSource = await readFile(new URL('./local-panda-dispatch-payload.ts', import.meta.url), 'utf8');
const appSource = await readFile(new URL('./app.ts', import.meta.url), 'utf8');
const consoleWidgetSettingsSource = await readFile(new URL('./console-widget-settings.ts', import.meta.url), 'utf8');
const serverPackageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8');
const migrationSource = await readFile(new URL('./migrations/0005_panda_delivery_intents.ts', import.meta.url), 'utf8');
const claimMigrationSource = await readFile(
  new URL('./migrations/0006_panda_delivery_intent_claims.ts', import.meta.url),
  'utf8',
);

function createFakeDatabase(
  initialIntents: StoredPandaDeliveryIntent[] = [],
  options: FakeDatabaseOptions = {},
): FakeDatabase {
  const conflictColumns: string[] = [];
  const insertAttempts: PandaDeliveryIntentInsertValues[] = [];
  const intents = [...initialIntents];
  const messages = [...(options.messages ?? [])];
  const selects: SelectLog[] = [];
  const updates: UpdateLog[] = [];
  let transactions = 0;

  function createIntentInsertQuery(tableName: string) {
    assert.equal(tableName, 'panda_delivery_intents');
    let pendingValues: PandaDeliveryIntentInsertValues | undefined;
    let conflictColumn: string | undefined;

    const query = {
      values: (values: PandaDeliveryIntentInsertValues) => {
        pendingValues = values;
        return query;
      },
      onConflict: (
        buildConflict: (builder: {
          column: (column: string) => {
            doNothing: () => unknown;
          };
        }) => unknown,
      ) => {
        buildConflict({
          column: (column: string) => {
            conflictColumn = column;
            conflictColumns.push(column);

            return {
              doNothing: () => query,
            };
          },
        });

        return query;
      },
      returning: () => query,
      executeTakeFirst: async () => {
        if (!pendingValues) {
          throw new Error('missing delivery intent insert values');
        }

        assert.equal(conflictColumn, 'visitor_message_id');
        insertAttempts.push(pendingValues);

        if (intents.some((intent) => intent.visitor_message_id === pendingValues?.visitor_message_id)) {
          return undefined;
        }

        const newIntent = {
          id: `intent-${intents.length + 1}`,
          ...pendingValues,
          claimed_at: pendingValues.claimed_at ?? null,
        };
        intents.push(newIntent);

        return { id: newIntent.id };
      },
    };

    return query;
  }

  function createIntentSelectQuery(tableName: string) {
    assert.equal(tableName, 'panda_delivery_intents');
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
          table: tableName,
          selectedColumns: [...selectedColumns],
          wheres: wheres.map((where) => ({ ...where })),
          orders: orders.map((order) => ({ ...order })),
          forUpdate,
          skipLocked,
          limit,
        });
        const [intent] = sortRows(intents.filter((row) => matchesWhereClauses(row, wheres)), orders).slice(0, limit);

        return intent ? { id: intent.id } : undefined;
      },
    };

    return query;
  }

  function createMessageSelectQuery(tableName: string) {
    assert.equal(tableName, 'messages');
    let selectedColumns: string[] = [];
    const wheres: WhereClause[] = [];

    const query = {
      select: (columns: string | string[]) => {
        selectedColumns = Array.isArray(columns) ? columns : [columns];
        return query;
      },
      where: (column: string, operator: string, value: unknown) => {
        wheres.push({ column, operator, value });
        return query;
      },
      executeTakeFirst: async () => {
        selects.push({
          table: tableName,
          selectedColumns: [...selectedColumns],
          wheres: wheres.map((where) => ({ ...where })),
          orders: [],
          forUpdate: false,
          skipLocked: false,
          limit: undefined,
        });

        return messages.find((row) => matchesWhereClauses(row, wheres));
      },
    };

    return query;
  }

  function createIntentUpdateQuery(tableName: string) {
    assert.equal(tableName, 'panda_delivery_intents');
    let updateValues: Record<string, unknown> = {};
    let returningColumns: string[] = [];
    const wheres: WhereClause[] = [];

    const query = {
      set: (values: Record<string, unknown>) => {
        updateValues = { ...values };
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
          table: tableName,
          updates: { ...updateValues },
          wheres: wheres.map((where) => ({ ...where })),
          returningColumns: [...returningColumns],
        });

        if (options.failClaimUpdate) {
          return undefined;
        }

        const intent = intents.find((row) => matchesWhereClauses(row, wheres));

        if (!intent) {
          return undefined;
        }

        Object.assign(intent, updateValues);

        return Object.fromEntries(returningColumns.map((column) => [column, intent[column as keyof StoredPandaDeliveryIntent]]));
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
    insertInto: createIntentInsertQuery,
    selectFrom: (tableName: string) => {
      if (tableName === 'panda_delivery_intents') {
        return createIntentSelectQuery(tableName);
      }

      if (tableName === 'messages') {
        return createMessageSelectQuery(tableName);
      }

      throw new Error(`Unexpected select table ${tableName}`);
    },
    updateTable: createIntentUpdateQuery,
  } as unknown as DatabaseClient;

  return {
    database,
    conflictColumns,
    insertAttempts,
    intents,
    messages,
    selects,
    updates,
    get transactions() {
      return transactions;
    },
  };
}

function intentRow(id: string, values: Partial<StoredPandaDeliveryIntent> = {}): StoredPandaDeliveryIntent {
  return {
    id,
    widget_id: 'widget-id',
    conversation_id: `conversation-${id}`,
    visitor_session_id: `visitor-session-${id}`,
    visitor_message_id: `visitor-message-${id}`,
    client_message_id: `client-message-${id}`,
    route_handle_snapshot: 'panda:workspace/alpha',
    status: 'queued',
    claimed_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...values,
  };
}

function messageRow(values: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: 'visitor-message-1',
    conversation_id: 'conversation-1',
    seq: 1,
    sender: 'visitor',
    client_message_id: 'client-message-1',
    body: 'Hello from the visitor',
    created_at: MESSAGE_CREATED_AT,
    ...values,
  };
}

function claimedIntent(values: Partial<ClaimedPandaDeliveryIntent> = {}): ClaimedPandaDeliveryIntent {
  return {
    id: 'intent-1',
    widgetId: 'widget-1',
    conversationId: 'conversation-1',
    visitorSessionId: 'visitor-session-1',
    visitorMessageId: 'visitor-message-1',
    clientMessageId: 'client-message-1',
    routeHandleSnapshot: 'panda:workspace/alpha',
    status: 'claimed',
    createdAt: NOW,
    claimedAt: CLAIMED_AT,
    ...values,
  };
}

test('recordPandaDeliveryIntent records one queued intent with a route handle snapshot', async () => {
  const fake = createFakeDatabase();

  const result = await recordPandaDeliveryIntent(fake.database, {
    widgetId: 'widget-id',
    conversationId: 'conversation-id',
    visitorSessionId: 'visitor-session-id',
    visitorMessageId: 'message-id',
    clientMessageId: 'client-message-id',
    routeHandle: '  panda:workspace/alpha  ',
    now: NOW,
  });

  assert.deepEqual(result, { recorded: true });
  assert.deepEqual(fake.conflictColumns, ['visitor_message_id']);
  assert.deepEqual(fake.insertAttempts, [
    {
      widget_id: 'widget-id',
      conversation_id: 'conversation-id',
      visitor_session_id: 'visitor-session-id',
      visitor_message_id: 'message-id',
      client_message_id: 'client-message-id',
      route_handle_snapshot: 'panda:workspace/alpha',
      status: 'queued',
      created_at: NOW,
      updated_at: NOW,
    },
  ]);
  assert.deepEqual(fake.intents, [
    {
      id: 'intent-1',
      widget_id: 'widget-id',
      conversation_id: 'conversation-id',
      visitor_session_id: 'visitor-session-id',
      visitor_message_id: 'message-id',
      client_message_id: 'client-message-id',
      route_handle_snapshot: 'panda:workspace/alpha',
      status: 'queued',
      claimed_at: null,
      created_at: NOW,
      updated_at: NOW,
    },
  ]);
});

test('recordPandaDeliveryIntent is a no-op without a configured route handle', async () => {
  const fake = createFakeDatabase();

  assert.deepEqual(await recordPandaDeliveryIntent(fake.database, {
    widgetId: 'widget-id',
    conversationId: 'conversation-id',
    visitorSessionId: 'visitor-session-id',
    visitorMessageId: 'message-id-1',
    clientMessageId: 'client-message-id-1',
    routeHandle: null,
    now: NOW,
  }), { recorded: false, reason: 'missing_route_handle' });
  assert.deepEqual(await recordPandaDeliveryIntent(fake.database, {
    widgetId: 'widget-id',
    conversationId: 'conversation-id',
    visitorSessionId: 'visitor-session-id',
    visitorMessageId: 'message-id-2',
    clientMessageId: 'client-message-id-2',
    routeHandle: '   ',
    now: NOW,
  }), { recorded: false, reason: 'missing_route_handle' });

  assert.deepEqual(fake.insertAttempts, []);
  assert.deepEqual(fake.intents, []);
});

test('recordPandaDeliveryIntent is idempotent by visitor message id', async () => {
  const fake = createFakeDatabase();
  const input = {
    widgetId: 'widget-id',
    conversationId: 'conversation-id',
    visitorSessionId: 'visitor-session-id',
    visitorMessageId: 'message-id',
    clientMessageId: 'client-message-id',
    routeHandle: 'panda:workspace/alpha',
    now: NOW,
  };

  assert.deepEqual(await recordPandaDeliveryIntent(fake.database, input), { recorded: true });
  assert.deepEqual(await recordPandaDeliveryIntent(fake.database, { ...input, routeHandle: 'panda:workspace/beta' }), {
    recorded: false,
    reason: 'already_recorded',
  });

  assert.equal(fake.intents.length, 1);
  assert.equal(fake.intents[0]?.route_handle_snapshot, 'panda:workspace/alpha');
  assert.deepEqual(fake.conflictColumns, ['visitor_message_id', 'visitor_message_id']);
});

test('claimNextQueuedPandaDeliveryIntent returns null with no queued rows', async () => {
  const fake = createFakeDatabase();

  assert.equal(await claimNextQueuedPandaDeliveryIntent(fake.database, { now: CLAIMED_AT }), null);
  assert.equal(fake.transactions, 1);
  assert.deepEqual(fake.updates, []);
  assert.deepEqual(fake.selects, [
    {
      table: 'panda_delivery_intents',
      selectedColumns: ['id'],
      wheres: [{ column: 'status', operator: '=', value: 'queued' }],
      orders: [
        { column: 'created_at', direction: 'asc' },
        { column: 'id', direction: 'asc' },
      ],
      forUpdate: true,
      skipLocked: true,
      limit: 1,
    },
  ]);
});

test('claimNextQueuedPandaDeliveryIntent skips already claimed rows', async () => {
  const fake = createFakeDatabase([
    intentRow('intent-claimed', {
      status: 'claimed',
      claimed_at: new Date('2026-01-01T00:04:00.000Z'),
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    }),
    intentRow('intent-queued', { created_at: new Date('2026-01-01T00:05:00.000Z') }),
  ]);

  const claimed = await claimNextQueuedPandaDeliveryIntent(fake.database, { now: CLAIMED_AT });

  assert.equal(claimed?.id, 'intent-queued');
  assert.equal(fake.intents[0]?.status, 'claimed');
  assert.equal(fake.intents[0]?.claimed_at?.toISOString(), '2026-01-01T00:04:00.000Z');
  assert.equal(fake.intents[1]?.status, 'claimed');
  assert.equal(fake.intents[1]?.claimed_at, CLAIMED_AT);
});

test('claimNextQueuedPandaDeliveryIntent claims the oldest queued row by created_at then id', async () => {
  const fake = createFakeDatabase([
    intentRow('intent-c', { created_at: new Date('2026-01-01T00:00:00.000Z') }),
    intentRow('intent-b', { created_at: new Date('2026-01-01T00:01:00.000Z') }),
    intentRow('intent-a', { created_at: new Date('2026-01-01T00:00:00.000Z') }),
  ]);

  const claimed = await claimNextQueuedPandaDeliveryIntent(fake.database, { now: CLAIMED_AT });

  assert.equal(claimed?.id, 'intent-a');
  assert.equal(fake.intents.find((intent) => intent.id === 'intent-a')?.status, 'claimed');
  assert.equal(fake.intents.find((intent) => intent.id === 'intent-c')?.status, 'queued');
  assert.equal(fake.intents.find((intent) => intent.id === 'intent-b')?.status, 'queued');
});

test('claimNextQueuedPandaDeliveryIntent updates only claim fields and returns camelCase Date DTO', async () => {
  const createdAt = new Date('2026-01-01T00:02:00.000Z');
  const fake = createFakeDatabase([
    intentRow('intent-1', {
      widget_id: 'widget-1',
      conversation_id: 'conversation-1',
      visitor_session_id: 'visitor-session-1',
      visitor_message_id: 'visitor-message-1',
      client_message_id: 'client-message-1',
      route_handle_snapshot: 'panda:workspace/one',
      created_at: createdAt,
      updated_at: new Date('2026-01-01T00:02:30.000Z'),
    }),
  ]);

  const claimed = await claimNextQueuedPandaDeliveryIntent(fake.database, { now: CLAIMED_AT });

  assert.deepEqual(Object.keys(claimed ?? {}).sort(), [
    'claimedAt',
    'clientMessageId',
    'conversationId',
    'createdAt',
    'id',
    'routeHandleSnapshot',
    'status',
    'visitorMessageId',
    'visitorSessionId',
    'widgetId',
  ]);
  assert.deepEqual(claimed, {
    id: 'intent-1',
    widgetId: 'widget-1',
    conversationId: 'conversation-1',
    visitorSessionId: 'visitor-session-1',
    visitorMessageId: 'visitor-message-1',
    clientMessageId: 'client-message-1',
    routeHandleSnapshot: 'panda:workspace/one',
    status: 'claimed',
    createdAt,
    claimedAt: CLAIMED_AT,
  });
  assert.equal(claimed?.createdAt instanceof Date, true);
  assert.equal(claimed?.claimedAt instanceof Date, true);
  assert.deepEqual(fake.updates, [
    {
      table: 'panda_delivery_intents',
      updates: { status: 'claimed', claimed_at: CLAIMED_AT, updated_at: CLAIMED_AT },
      wheres: [
        { column: 'id', operator: '=', value: 'intent-1' },
        { column: 'status', operator: '=', value: 'queued' },
      ],
      returningColumns: [
        'id',
        'widget_id',
        'conversation_id',
        'visitor_session_id',
        'visitor_message_id',
        'client_message_id',
        'route_handle_snapshot',
        'status',
        'created_at',
        'claimed_at',
      ],
    },
  ]);
  assert.deepEqual(fake.intents[0], {
    id: 'intent-1',
    widget_id: 'widget-1',
    conversation_id: 'conversation-1',
    visitor_session_id: 'visitor-session-1',
    visitor_message_id: 'visitor-message-1',
    client_message_id: 'client-message-1',
    route_handle_snapshot: 'panda:workspace/one',
    status: 'claimed',
    claimed_at: CLAIMED_AT,
    created_at: createdAt,
    updated_at: CLAIMED_AT,
  });
});

test('claimNextQueuedPandaDeliveryIntent throws when the selected queued row cannot be updated', async () => {
  const fake = createFakeDatabase([intentRow('intent-1')], { failClaimUpdate: true });

  await assert.rejects(
    claimNextQueuedPandaDeliveryIntent(fake.database, { now: CLAIMED_AT }),
    /Unable to claim selected Panda delivery intent intent-1/,
  );
  assert.equal(fake.transactions, 1);
  assert.equal(fake.intents[0]?.status, 'queued');
  assert.equal(fake.intents[0]?.claimed_at, null);
});

test('claimQueuedPandaDeliveryIntentById claims only the requested queued row', async () => {
  const olderIntent = intentRow('intent-older', { created_at: new Date('2026-01-01T00:00:00.000Z') });
  const targetIntent = intentRow('intent-target', { created_at: new Date('2026-01-01T00:05:00.000Z') });
  const fake = createFakeDatabase([olderIntent, targetIntent]);

  const claimed = await claimQueuedPandaDeliveryIntentById(fake.database, 'intent-target', { now: CLAIMED_AT });

  assert.equal(claimed?.id, 'intent-target');
  assert.equal(olderIntent.status, 'queued');
  assert.equal(olderIntent.claimed_at, null);
  assert.equal(targetIntent.status, 'claimed');
  assert.equal(targetIntent.claimed_at, CLAIMED_AT);
  assert.deepEqual(fake.updates, [
    {
      table: 'panda_delivery_intents',
      updates: { status: 'claimed', claimed_at: CLAIMED_AT, updated_at: CLAIMED_AT },
      wheres: [
        { column: 'id', operator: '=', value: 'intent-target' },
        { column: 'status', operator: '=', value: 'queued' },
      ],
      returningColumns: [
        'id',
        'widget_id',
        'conversation_id',
        'visitor_session_id',
        'visitor_message_id',
        'client_message_id',
        'route_handle_snapshot',
        'status',
        'created_at',
        'claimed_at',
      ],
    },
  ]);
  assert.deepEqual(fake.selects, []);
  assert.equal(fake.transactions, 1);
});

test('claimQueuedPandaDeliveryIntentById returns null for missing or non-queued targets without claiming another queued row', async () => {
  const queuedIntent = intentRow('intent-queued');
  const claimedIntent = intentRow('intent-claimed', {
    status: 'claimed',
    claimed_at: new Date('2026-01-01T00:03:00.000Z'),
  });
  const fake = createFakeDatabase([queuedIntent, claimedIntent]);

  assert.equal(await claimQueuedPandaDeliveryIntentById(fake.database, 'intent-missing', { now: CLAIMED_AT }), null);
  assert.equal(await claimQueuedPandaDeliveryIntentById(fake.database, 'intent-claimed', { now: CLAIMED_AT }), null);

  assert.equal(queuedIntent.status, 'queued');
  assert.equal(queuedIntent.claimed_at, null);
  assert.equal(claimedIntent.status, 'claimed');
  assert.equal(claimedIntent.claimed_at?.toISOString(), '2026-01-01T00:03:00.000Z');
  assert.equal(fake.transactions, 2);
  assert.deepEqual(fake.updates.map((update) => update.wheres), [
    [
      { column: 'id', operator: '=', value: 'intent-missing' },
      { column: 'status', operator: '=', value: 'queued' },
    ],
    [
      { column: 'id', operator: '=', value: 'intent-claimed' },
      { column: 'status', operator: '=', value: 'queued' },
    ],
  ]);
});

test('buildLocalPandaDispatchPayloadV1 builds a local-only v1 envelope from a claimed intent and visitor message', async () => {
  const fake = createFakeDatabase([], { messages: [messageRow()] });

  const result = await buildLocalPandaDispatchPayloadV1(fake.database, claimedIntent());

  if (!result.built) {
    assert.fail(`expected payload to be built, got ${result.reason}`);
  }

  assert.match(result.payload.idempotencyKey, /^local-panda-dispatch-v1:[0-9a-f]{64}$/);
  assert.deepEqual(result.payload, {
    version: 1,
    kind: 'local-panda-future-dispatch',
    idempotencyKey: result.payload.idempotencyKey,
    routeHandleSnapshot: 'panda:workspace/alpha',
    intent: {
      id: 'intent-1',
      status: 'claimed',
      createdAt: NOW.toISOString(),
      claimedAt: CLAIMED_AT.toISOString(),
    },
    widget: { id: 'widget-1' },
    conversation: { id: 'conversation-1' },
    visitorSession: { id: 'visitor-session-1' },
    visitorMessage: {
      id: 'visitor-message-1',
      clientMessageId: 'client-message-1',
      body: 'Hello from the visitor',
      text: 'Hello from the visitor',
      createdAt: MESSAGE_CREATED_AT.toISOString(),
    },
    correlationIds: {
      intentId: 'intent-1',
      widgetId: 'widget-1',
      conversationId: 'conversation-1',
      visitorSessionId: 'visitor-session-1',
      visitorMessageId: 'visitor-message-1',
      clientMessageId: 'client-message-1',
    },
    metadata: {
      locality: 'local-only',
      dispatch: 'future-dispatch',
      contract: 'contract-only',
      network: 'no-network',
      stateMutation: 'no-state-mutation',
      replyHandling: 'no-reply-handling',
    },
  });
});

test('buildLocalPandaDispatchPayloadV1 refuses unclaimed intents before reading visitor messages', async () => {
  const cases: ClaimedPandaDeliveryIntent[] = [
    { ...claimedIntent(), status: 'queued' } as unknown as ClaimedPandaDeliveryIntent,
    { ...claimedIntent(), claimedAt: null } as unknown as ClaimedPandaDeliveryIntent,
    claimedIntent({ claimedAt: new Date('not-a-date') }),
  ];

  for (const intent of cases) {
    const fake = createFakeDatabase([], { messages: [messageRow()] });

    assert.deepEqual(await buildLocalPandaDispatchPayloadV1(fake.database, intent), {
      built: false,
      reason: 'intent_not_claimed',
    });
    assert.deepEqual(fake.selects, []);
  }
});

test('buildLocalPandaDispatchPayloadV1 refuses missing route snapshots before reading visitor messages', async () => {
  const fake = createFakeDatabase([], { messages: [messageRow()] });

  assert.deepEqual(
    await buildLocalPandaDispatchPayloadV1(fake.database, claimedIntent({ routeHandleSnapshot: '   ' })),
    { built: false, reason: 'missing_route_handle' },
  );
  assert.deepEqual(fake.selects, []);
});

test('buildLocalPandaDispatchPayloadV1 validates visitor message context and correlation', async () => {
  const cases: Array<{
    messages: StoredMessage[];
    reason: 'visitor_message_not_found' | 'visitor_message_not_visitor' | 'message_correlation_mismatch';
  }> = [
    { messages: [], reason: 'visitor_message_not_found' },
    { messages: [messageRow({ sender: 'agent', client_message_id: null })], reason: 'visitor_message_not_visitor' },
    { messages: [messageRow({ client_message_id: null })], reason: 'message_correlation_mismatch' },
    { messages: [messageRow({ client_message_id: 'other-client-message' })], reason: 'message_correlation_mismatch' },
    { messages: [messageRow({ conversation_id: 'other-conversation' })], reason: 'message_correlation_mismatch' },
  ];

  for (const testCase of cases) {
    const fake = createFakeDatabase([], { messages: testCase.messages });

    assert.deepEqual(await buildLocalPandaDispatchPayloadV1(fake.database, claimedIntent()), {
      built: false,
      reason: testCase.reason,
    });
    assert.deepEqual(fake.selects, [
      {
        table: 'messages',
        selectedColumns: ['id', 'conversation_id', 'sender', 'client_message_id', 'body', 'created_at'],
        wheres: [{ column: 'id', operator: '=', value: 'visitor-message-1' }],
        orders: [],
        forUpdate: false,
        skipLocked: false,
        limit: undefined,
      },
    ]);
  }
});

test('buildLocalPandaDispatchPayloadV1 idempotency is stable and changes with valid correlation changes', async () => {
  const fake = createFakeDatabase([], { messages: [messageRow()] });

  const first = await buildLocalPandaDispatchPayloadV1(fake.database, claimedIntent());
  const second = await buildLocalPandaDispatchPayloadV1(fake.database, claimedIntent());
  const changedTimestamps = await buildLocalPandaDispatchPayloadV1(
    createFakeDatabase([], { messages: [messageRow({ created_at: new Date('2026-01-01T00:06:00.000Z') })] }).database,
    claimedIntent({ createdAt: new Date('2026-01-01T00:02:00.000Z'), claimedAt: new Date('2026-01-01T00:11:00.000Z') }),
  );
  const changedBody = await buildLocalPandaDispatchPayloadV1(
    createFakeDatabase([], { messages: [messageRow({ body: 'Edited visitor body' })] }).database,
    claimedIntent(),
  );
  const changed = await buildLocalPandaDispatchPayloadV1(
    createFakeDatabase([], {
      messages: [messageRow({ id: 'visitor-message-2', client_message_id: 'client-message-2' })],
    }).database,
    claimedIntent({ visitorMessageId: 'visitor-message-2', clientMessageId: 'client-message-2' }),
  );

  if (!first.built || !second.built || !changedTimestamps.built || !changedBody.built || !changed.built) {
    assert.fail('expected all idempotency payloads to be validly built');
  }

  assert.equal(first.payload.idempotencyKey, second.payload.idempotencyKey);
  assert.equal(first.payload.idempotencyKey, changedTimestamps.payload.idempotencyKey);
  assert.equal(first.payload.idempotencyKey, changedBody.payload.idempotencyKey);
  assert.notEqual(first.payload.idempotencyKey, changed.payload.idempotencyKey);

  const idempotencySource = sourceBetween(
    payloadSource,
    'function buildLocalPandaDispatchPayloadV1IdempotencyKey',
    '\nfunction isValidDate',
  );
  assert.match(idempotencySource, /JSON\.stringify\(fields\)/);
  assert.doesNotMatch(idempotencySource, /\.join\(/);
});

test('prepareNextLocalPandaDispatchDryRun reports no queued intent without building a payload', async () => {
  const fake = createFakeDatabase([], { messages: [messageRow()] });

  assert.deepEqual(await prepareNextLocalPandaDispatchDryRun(fake.database, { now: CLAIMED_AT }), {
    prepared: false,
    reason: 'no_queued_intent',
  });
  assert.equal(fake.transactions, 1);
  assert.deepEqual(fake.updates, []);
  assert.equal(fake.selects.some((select) => select.table === 'messages'), false);
});

test('prepareNextLocalPandaDispatchDryRun claims the oldest queued intent and returns the v1 payload', async () => {
  const olderCreatedAt = new Date('2026-01-01T00:01:00.000Z');
  const newerCreatedAt = new Date('2026-01-01T00:02:00.000Z');
  const fake = createFakeDatabase(
    [
      intentRow('intent-newer', { created_at: newerCreatedAt }),
      intentRow('intent-older', {
        widget_id: 'widget-oldest',
        conversation_id: 'conversation-oldest',
        visitor_session_id: 'visitor-session-oldest',
        visitor_message_id: 'visitor-message-oldest',
        client_message_id: 'client-message-oldest',
        route_handle_snapshot: 'panda:workspace/oldest',
        created_at: olderCreatedAt,
      }),
    ],
    {
      messages: [
        messageRow({
          id: 'visitor-message-oldest',
          conversation_id: 'conversation-oldest',
          client_message_id: 'client-message-oldest',
          body: 'Oldest queued visitor message',
        }),
      ],
    },
  );

  const result = await prepareNextLocalPandaDispatchDryRun(fake.database, { now: CLAIMED_AT });

  if (!result.prepared) {
    assert.fail(`expected a prepared payload, got ${result.reason}`);
  }

  assert.match(result.payload.idempotencyKey, /^local-panda-dispatch-v1:[0-9a-f]{64}$/);
  assert.deepEqual(result, {
    prepared: true,
    payload: {
      version: 1,
      kind: 'local-panda-future-dispatch',
      idempotencyKey: result.payload.idempotencyKey,
      routeHandleSnapshot: 'panda:workspace/oldest',
      intent: {
        id: 'intent-older',
        status: 'claimed',
        createdAt: olderCreatedAt.toISOString(),
        claimedAt: CLAIMED_AT.toISOString(),
      },
      widget: { id: 'widget-oldest' },
      conversation: { id: 'conversation-oldest' },
      visitorSession: { id: 'visitor-session-oldest' },
      visitorMessage: {
        id: 'visitor-message-oldest',
        clientMessageId: 'client-message-oldest',
        body: 'Oldest queued visitor message',
        text: 'Oldest queued visitor message',
        createdAt: MESSAGE_CREATED_AT.toISOString(),
      },
      correlationIds: {
        intentId: 'intent-older',
        widgetId: 'widget-oldest',
        conversationId: 'conversation-oldest',
        visitorSessionId: 'visitor-session-oldest',
        visitorMessageId: 'visitor-message-oldest',
        clientMessageId: 'client-message-oldest',
      },
      metadata: {
        locality: 'local-only',
        dispatch: 'future-dispatch',
        contract: 'contract-only',
        network: 'no-network',
        stateMutation: 'no-state-mutation',
        replyHandling: 'no-reply-handling',
      },
    },
  });
  assert.equal(fake.intents.find((intent) => intent.id === 'intent-older')?.status, 'claimed');
  assert.equal(fake.intents.find((intent) => intent.id === 'intent-older')?.claimed_at, CLAIMED_AT);
  assert.equal(fake.intents.find((intent) => intent.id === 'intent-newer')?.status, 'queued');
});

test('prepareNextLocalPandaDispatchDryRun returns a controlled build failure after claiming', async () => {
  const fake = createFakeDatabase([intentRow('intent-1')]);

  assert.deepEqual(await prepareNextLocalPandaDispatchDryRun(fake.database, { now: CLAIMED_AT }), {
    prepared: false,
    reason: 'visitor_message_not_found',
  });
  assert.equal(fake.intents[0]?.status, 'claimed');
  assert.equal(fake.intents[0]?.claimed_at, CLAIMED_AT);
});

test('runLocalPandaDispatchDryRunCli prints explicit JSON for prepared results and closes the database', async () => {
  const database = {} as DatabaseClient;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  const result = { prepared: false, reason: 'no_queued_intent' } as const;
  let closedDatabase: DatabaseClient | undefined;

  await runLocalPandaDispatchDryRunCli({
    loadDatabaseConfig: () => ({ url: 'postgresql://user:pass@127.0.0.1:5432/widget' }),
    createDatabase: (config) => {
      assert.equal(config.url, 'postgresql://user:pass@127.0.0.1:5432/widget');

      return database;
    },
    prepareNextLocalPandaDispatchDryRun: async (client) => {
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
});

test('runLocalPandaDispatchDryRunCli writes safe stderr and exit 1 for unexpected errors', async () => {
  const database = {} as DatabaseClient;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  let closedDatabase: DatabaseClient | undefined;

  await runLocalPandaDispatchDryRunCli({
    loadDatabaseConfig: () => ({ url: 'postgresql://user:super-secret@127.0.0.1:5432/widget' }),
    createDatabase: () => database,
    prepareNextLocalPandaDispatchDryRun: async () => {
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
  assert.equal(stderr[0], 'failed to prepare local Panda dispatch payload dry run\n');
  assert.deepEqual(JSON.parse(stderr[1] ?? '{}'), {
    name: 'Error',
    message: 'database refused postgresql://user:[redacted]@127.0.0.1:5432/widget',
  });
  assert.equal(stderr.join('').includes('super-secret'), false);
});

test('buildLocalPandaDispatchPayloadV1 only reads messages and has no dispatch side effects', async () => {
  const fake = createFakeDatabase([], { messages: [messageRow()] });

  const result = await buildLocalPandaDispatchPayloadV1(fake.database, claimedIntent());

  assert.equal(result.built, true);
  assert.deepEqual(fake.selects, [
    {
      table: 'messages',
      selectedColumns: ['id', 'conversation_id', 'sender', 'client_message_id', 'body', 'created_at'],
      wheres: [{ column: 'id', operator: '=', value: 'visitor-message-1' }],
      orders: [],
      forUpdate: false,
      skipLocked: false,
      limit: undefined,
    },
  ]);
  assert.deepEqual(fake.insertAttempts, []);
  assert.deepEqual(fake.updates, []);
  assert.equal(fake.transactions, 0);

  const builderSource = sourceBetween(
    payloadSource,
    'export async function buildLocalPandaDispatchPayloadV1',
    '\nfunction toLocalPandaDispatchPayloadV1',
  );
  assert.equal((builderSource.match(/selectFrom\('/g) ?? []).length, 1);
  assert.match(builderSource, /selectFrom\('messages'\)/);
  assert.doesNotMatch(
    builderSource,
    /insertInto|updateTable|transaction\(\)|Gateway|\bCLI\b|fetch|WebSocket|child_process|dispatcher|Worker|setTimeout|setInterval|retry|dead-letter|delivered|failed|reply-ingestion/i,
  );
});

test('local Panda dispatch dry run composes existing local helpers without dispatch, network, or worker behavior', () => {
  const combinedSource = `${dryRunSource}\n${dryRunCliSource}`;

  assert.match(dryRunSource, /claimNextQueuedPandaDeliveryIntent/);
  assert.match(dryRunSource, /buildLocalPandaDispatchPayloadV1/);
  assert.doesNotMatch(dryRunSource, /insertInto|updateTable|transaction\(\)/);
  assert.doesNotMatch(
    combinedSource,
    /fetch\s*\(|WebSocket|node:child_process|child_process|setTimeout\s*\(|setInterval\s*\(|Worker\s*\(|Gateway|panda\s+a2a|panda\s+send|panda\s+gateway|retry|dead-letter|reply-ingestion|dispatcher|daemon|status:\s*'sent'|status:\s*'delivered'|status:\s*'failed'/i,
  );
});

test('local Panda dispatch dry run stays on the server CLI surface only', () => {
  const serverPackage = JSON.parse(serverPackageSource) as { scripts?: Record<string, string> };

  assert.equal(
    serverPackage.scripts?.['local-panda:dispatch-dry-run'],
    'node dist/local-panda-dispatch-dry-run-cli.js',
  );
  assert.doesNotMatch(appSource, /local-panda-dispatch-dry-run|prepareNextLocalPandaDispatchDryRun|runLocalPandaDispatchDryRunCli/);
  assert.doesNotMatch(
    consoleWidgetSettingsSource,
    /local-panda-dispatch-dry-run|prepareNextLocalPandaDispatchDryRun|runLocalPandaDispatchDryRunCli/,
  );
});

test('panda delivery intent helper is local-only storage and claim plumbing without dispatch behavior', () => {
  assert.doesNotMatch(
    helperSource,
    /buildLocalPandaDispatchPayloadV1|LocalPandaDispatchPayloadV1|idempotencyKey|future-dispatch|local-panda-dispatch-dry-run|prepareNextLocalPandaDispatchDryRun/,
  );
  assert.match(helperSource, /insertInto\('panda_delivery_intents'\)/);
  assert.match(helperSource, /onConflict/);
  assert.match(helperSource, /transaction\(\)\.execute\(async \(transaction\) =>/);
  assert.match(
    helperSource,
    /selectFrom\('panda_delivery_intents'\)[\s\S]*where\('status', '=', 'queued'\)[\s\S]*orderBy\('created_at', 'asc'\)[\s\S]*orderBy\('id', 'asc'\)[\s\S]*forUpdate\(\)[\s\S]*skipLocked\(\)/,
  );
  assert.match(
    helperSource,
    /updateTable\('panda_delivery_intents'\)[\s\S]*set\(\{ status: 'claimed', claimed_at: now, updated_at: now \}\)[\s\S]*where\('id', '=', selected\.id\)[\s\S]*where\('status', '=', 'queued'\)/,
  );
  assert.match(
    helperSource,
    /export async function claimQueuedPandaDeliveryIntentById[\s\S]*updateTable\('panda_delivery_intents'\)[\s\S]*where\('id', '=', targetIntentId\)[\s\S]*where\('status', '=', 'queued'\)[\s\S]*return claimed \? toClaimedPandaDeliveryIntent\(claimed\) : null/,
  );
  for (const column of [
    'id',
    'widget_id',
    'conversation_id',
    'visitor_session_id',
    'visitor_message_id',
    'client_message_id',
    'route_handle_snapshot',
    'status',
    'created_at',
    'claimed_at',
  ]) {
    assert.match(helperSource, new RegExp(`'${column}'`));
  }
  assert.doesNotMatch(
    helperSource,
    /Gateway|\bCLI\b|fetch|WebSocket|child_process|dispatcher|Worker|setTimeout|setInterval|retry|dead-letter|delivered|failed|reply-ingestion/i,
  );
});

test('panda delivery intent migration is local-only and idempotent by visitor message', () => {
  assert.match(migrationSource, /create table panda_delivery_intents/);
  assert.match(migrationSource, /widget_id uuid not null references widgets\(id\) on delete cascade/);
  assert.match(migrationSource, /conversation_id uuid not null references conversations\(id\) on delete cascade/);
  assert.match(migrationSource, /visitor_session_id uuid not null references visitor_sessions\(id\) on delete cascade/);
  assert.match(migrationSource, /visitor_message_id uuid not null references messages\(id\) on delete cascade/);
  assert.match(migrationSource, /client_message_id text not null/);
  assert.match(migrationSource, /route_handle_snapshot text not null/);
  assert.match(migrationSource, /status text not null default 'queued'/);
  assert.match(migrationSource, /check \(status in \('queued'\)\)/);
  assert.match(migrationSource, /unique \(visitor_message_id\)/);
  assert.doesNotMatch(migrationSource, /unique \([^)]*client_message_id/);
});

test('panda delivery intent claim migration adds local claimed state and reversible normalization', () => {
  assert.match(claimMigrationSource, /add column claimed_at timestamptz/);
  assert.equal(
    (claimMigrationSource.match(/drop constraint panda_delivery_intents_status_check/g) ?? []).length,
    2,
  );
  assert.match(
    claimMigrationSource,
    /add constraint panda_delivery_intents_status_check check \(status in \('queued', 'claimed'\)\)/,
  );
  assert.match(
    claimMigrationSource,
    /update panda_delivery_intents set status = 'queued' where status = 'claimed'/,
  );
  assert.match(
    claimMigrationSource,
    /add constraint panda_delivery_intents_status_check check \(status in \('queued'\)\)/,
  );
  assert.match(claimMigrationSource, /drop column claimed_at/);
});

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source start ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `missing source end ${end}`);

  return source.slice(startIndex, endIndex);
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

function sortRows(rows: StoredPandaDeliveryIntent[], orders: OrderClause[]): StoredPandaDeliveryIntent[] {
  return [...rows].sort((left, right) => {
    for (const order of orders) {
      const leftValue = comparableValue(left[order.column as keyof StoredPandaDeliveryIntent]);
      const rightValue = comparableValue(right[order.column as keyof StoredPandaDeliveryIntent]);

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

function comparableValue(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
