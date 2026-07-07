import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { DatabaseClient, PandaDeliveryIntentStatus } from './db.ts';
import { claimNextQueuedPandaDeliveryIntent, recordPandaDeliveryIntent } from './panda-delivery-intents.ts';

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
};

type FakeDatabase = {
  database: DatabaseClient;
  conflictColumns: string[];
  insertAttempts: PandaDeliveryIntentInsertValues[];
  intents: StoredPandaDeliveryIntent[];
  selects: SelectLog[];
  updates: UpdateLog[];
  transactions: number;
};

const NOW = new Date('2026-01-01T00:00:00.000Z');
const CLAIMED_AT = new Date('2026-01-01T00:10:00.000Z');
const helperSource = await readFile(new URL('./panda-delivery-intents.ts', import.meta.url), 'utf8');
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
    selectFrom: createIntentSelectQuery,
    updateTable: createIntentUpdateQuery,
  } as unknown as DatabaseClient;

  return {
    database,
    conflictColumns,
    insertAttempts,
    intents,
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

test('panda delivery intent helper is local-only storage and claim plumbing without dispatch behavior', () => {
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
  for (const column of [
    'id',
    'widget_id',
    'conversation_id',
    'visitor_session_id',
    'visitor_message_id',
    'client_message_id',
    'route_handle_snapshot',
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

function matchesWhereClauses(row: StoredPandaDeliveryIntent, wheres: WhereClause[]): boolean {
  return wheres.every((where) => {
    const value = row[where.column as keyof StoredPandaDeliveryIntent];

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
