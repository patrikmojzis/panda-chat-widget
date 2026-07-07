import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { DatabaseClient, PandaDeliveryIntentStatus } from './db.ts';
import { recordPandaDeliveryIntent } from './panda-delivery-intents.ts';

type StoredPandaDeliveryIntent = {
  id: string;
  widget_id: string;
  conversation_id: string;
  visitor_session_id: string;
  visitor_message_id: string;
  client_message_id: string;
  route_handle_snapshot: string;
  status: PandaDeliveryIntentStatus;
  created_at: Date;
  updated_at: Date;
};

type PandaDeliveryIntentInsertValues = Omit<StoredPandaDeliveryIntent, 'id'>;

type FakeDatabase = {
  database: DatabaseClient;
  conflictColumns: string[];
  insertAttempts: PandaDeliveryIntentInsertValues[];
  intents: StoredPandaDeliveryIntent[];
};

const NOW = new Date('2026-01-01T00:00:00.000Z');
const helperSource = await readFile(new URL('./panda-delivery-intents.ts', import.meta.url), 'utf8');
const migrationSource = await readFile(new URL('./migrations/0005_panda_delivery_intents.ts', import.meta.url), 'utf8');

function createFakeDatabase(initialIntents: StoredPandaDeliveryIntent[] = []): FakeDatabase {
  const conflictColumns: string[] = [];
  const insertAttempts: PandaDeliveryIntentInsertValues[] = [];
  const intents = [...initialIntents];

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
        };
        intents.push(newIntent);

        return { id: newIntent.id };
      },
    };

    return query;
  }

  const database = {
    insertInto: createIntentInsertQuery,
  } as unknown as DatabaseClient;

  return { database, conflictColumns, insertAttempts, intents };
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


test('panda delivery intent helper is local-only storage without Gateway, CLI, network, worker, or timer behavior', () => {
  assert.match(helperSource, /insertInto\('panda_delivery_intents'\)/);
  assert.match(helperSource, /onConflict/);
  assert.doesNotMatch(
    helperSource,
    /Gateway|\bCLI\b|fetch|WebSocket|child_process|Worker|setTimeout|setInterval/i,
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
