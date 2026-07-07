import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildApp } from './app.ts';
import { createFakeResponderReply } from './fake-responder.ts';
import { createConversationMessageEventEmitter } from './message-events.ts';
import type { ConversationStatus, DatabaseClient, MessageSender, PandaDeliveryIntentStatus } from './db.ts';
import type { AllowedDomainRecord } from './origin-domain.ts';
import type { PublicWriteRateLimitInput } from './rate-limit.ts';
import { DEMO_SEED_DATA } from './seed-data.ts';
import { findConversationForVisitorMessage } from './visitor-message.ts';

type WidgetLookupRow = {
  widgetId: string;
  siteId: string;
  publicKey: string;
  panda_route_handle?: string | null;
  widgetEnabled: boolean;
  siteEnabled: boolean;
};

type StoredVisitorSession = {
  id: string;
  widget_id: string;
};

type StoredConversation = {
  id: string;
  widget_id: string;
  visitor_session_id: string | null;
  status: ConversationStatus;
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

type MessageInsertConflictTarget = {
  columns: string[];
  where: { column: string; operator: string; value: null } | null;
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
  created_at: Date;
  updated_at: Date;
};

type PandaDeliveryIntentInsertValues = Omit<StoredPandaDeliveryIntent, 'id'>;

type FakeDatabaseOptions = {
  widget?: WidgetLookupRow;
  allowedDomains?: AllowedDomainRecord[];
  visitorSessions?: StoredVisitorSession[];
  conversations?: StoredConversation[];
  messages?: StoredMessage[];
  deliveryIntents?: StoredPandaDeliveryIntent[];
  intentInsertError?: Error;
  visitorInsertRaceMessage?: StoredMessage;
};

type FakeDatabase = {
  database: DatabaseClient;
  publicKeyLookups: string[];
  allowedDomainWidgetLookups: string[];
  enabledDomainFilters: boolean[];
  visitorSessionLookups: Array<{ id: string; widgetId: string }>;
  conversationLookups: Array<{ id: string; widgetId: string; visitorSessionId: string }>;
  messageSeqLookups: string[];
  messageClientMessageLookups: Array<{ conversationId: string; clientMessageId: string }>;
  messageReadLookups: Array<{ conversationId: string; afterSeq?: number }>;
  messageInserts: MessageInsertValues[];
  messageInsertConflictTargets: MessageInsertConflictTarget[];
  messageInsertConflictDoNothingCount: number;
  deliveryIntentConflictColumns: string[];
  deliveryIntentInserts: PandaDeliveryIntentInsertValues[];
  deliveryIntents: StoredPandaDeliveryIntent[];
  messages: StoredMessage[];
  operationLog: string[];
  transactions: number;
};

const VISITOR_SESSION_ID_A = 'visitor-session-a';
const VISITOR_SESSION_ID_B = 'visitor-session-b';
const CONVERSATION_ID_A = 'conversation-a';
const CONVERSATION_ID_B = 'conversation-b';
const FIRST_CREATED_AT = new Date('2026-01-01T00:00:00Z');
const visitorMessageSource = await readFile(new URL('./visitor-message.ts', import.meta.url), 'utf8');
const visitorMessageEventsSource = await readFile(new URL('./visitor-message-events.ts', import.meta.url), 'utf8');
const visitorMessageEventRouteSource = `${visitorMessageSource}\n${visitorMessageEventsSource}`;


function assertNoPandaConnectionFields(value: unknown): void {
  const serialized = JSON.stringify(value);

  assert.doesNotMatch(
    serialized,
    /connection|routeHandle|panda_route_handle|deliveryIntent|deliveryStatus|panda_delivery_intent|pandaDeliveryIntent|intentId|localDelivery|queuedIntentCount|lastQueuedAt/i,
  );
}

function enabledDemoWidget(): WidgetLookupRow {
  return {
    widgetId: 'widget-id',
    siteId: 'site-id',
    publicKey: DEMO_SEED_DATA.publicWidgetKey,
    panda_route_handle: 'panda:workspace/alpha',
    widgetEnabled: true,
    siteEnabled: true,
  };
}

function createFakeDatabase(options: FakeDatabaseOptions = {}): FakeDatabase {
  const publicKeyLookups: string[] = [];
  const allowedDomainWidgetLookups: string[] = [];
  const enabledDomainFilters: boolean[] = [];
  const visitorSessionLookups: Array<{ id: string; widgetId: string }> = [];
  const conversationLookups: Array<{ id: string; widgetId: string; visitorSessionId: string }> = [];
  const messageSeqLookups: string[] = [];
  const messageClientMessageLookups: Array<{ conversationId: string; clientMessageId: string }> = [];
  const messageReadLookups: Array<{ conversationId: string; afterSeq?: number }> = [];
  const messageInserts: MessageInsertValues[] = [];
  const messageInsertConflictTargets: MessageInsertConflictTarget[] = [];
  let messageInsertConflictDoNothingCount = 0;
  const deliveryIntentConflictColumns: string[] = [];
  const deliveryIntentInserts: PandaDeliveryIntentInsertValues[] = [];
  const operationLog: string[] = [];
  let transactions = 0;
  let visitorInsertRaceMessage = options.visitorInsertRaceMessage;
  const visitorSessions = [...(options.visitorSessions ?? [])];
  const conversations = [...(options.conversations ?? [])];
  const messages = [...(options.messages ?? [])];
  const deliveryIntents = [...(options.deliveryIntents ?? [])];

  const widgetQuery = {
    innerJoin: () => widgetQuery,
    select: () => widgetQuery,
    where: (_column: string, _operator: string, value: string) => {
      publicKeyLookups.push(value);
      return widgetQuery;
    },
    executeTakeFirst: async () => options.widget,
  };

  const allowedDomainsQuery = {
    select: () => allowedDomainsQuery,
    where: (column: string, _operator: string, value: string | boolean) => {
      if (column === 'widget_id' && typeof value === 'string') {
        allowedDomainWidgetLookups.push(value);
      }

      if (column === 'enabled' && typeof value === 'boolean') {
        enabledDomainFilters.push(value);
      }

      return allowedDomainsQuery;
    },
    execute: async () =>
      enabledDomainFilters.includes(true)
        ? (options.allowedDomains ?? []).filter((allowedDomain) => allowedDomain.enabled)
        : (options.allowedDomains ?? []),
  };

  function createVisitorSessionSelectQuery() {
    let id: string | undefined;
    let widgetId: string | undefined;

    const query = {
      select: () => query,
      where: (column: string, _operator: string, value: string) => {
        if (column === 'id') {
          id = value;
        }

        if (column === 'widget_id') {
          widgetId = value;
        }

        return query;
      },
      executeTakeFirst: async () => {
        if (!id || !widgetId) {
          throw new Error('missing visitor session lookup filters');
        }

        visitorSessionLookups.push({ id, widgetId });
        const visitorSession = visitorSessions.find(
          (session) => session.id === id && session.widget_id === widgetId,
        );

        return visitorSession ? { id: visitorSession.id } : undefined;
      },
    };

    return query;
  }

  function createConversationSelectQuery() {
    let id: string | undefined;
    let widgetId: string | undefined;
    let visitorSessionId: string | undefined;

    const query = {
      select: () => query,
      where: (column: string, _operator: string, value: string) => {
        if (column === 'id') {
          id = value;
        }

        if (column === 'widget_id') {
          widgetId = value;
        }

        if (column === 'visitor_session_id') {
          visitorSessionId = value;
        }

        return query;
      },
      executeTakeFirst: async () => {
        if (!id || !widgetId || !visitorSessionId) {
          throw new Error('missing conversation ownership filters');
        }

        conversationLookups.push({ id, widgetId, visitorSessionId });
        const conversation = conversations.find(
          (row) =>
            row.id === id && row.widget_id === widgetId && row.visitor_session_id === visitorSessionId,
        );

        if (!conversation) {
          return undefined;
        }

        return { id: conversation.id, status: conversation.status };
      },
    };

    return query;
  }

  function createMessageSelectQuery() {
    let conversationId: string | undefined;
    let clientMessageId: string | undefined;
    let sender: MessageSender | undefined;
    let afterSeq: number | undefined;
    let order: 'asc' | 'desc' = 'asc';
    let limitCount: number | undefined;

    const query = {
      select: () => query,
      where: (column: string, operator: string, value: string | number) => {
        if (column === 'conversation_id') {
          assert.equal(operator, '=');
          if (typeof value !== 'string') {
            throw new Error('expected string conversation_id value');
          }

          conversationId = value;
          return query;
        }

        if (column === 'client_message_id') {
          assert.equal(operator, '=');
          if (typeof value !== 'string') {
            throw new Error('expected string client_message_id value');
          }

          clientMessageId = value;
          return query;
        }

        if (column === 'sender') {
          assert.equal(operator, '=');
          assert.equal(value, 'visitor');
          sender = 'visitor';
          return query;
        }

        assert.equal(column, 'seq');
        assert.equal(operator, '>');
        if (typeof value !== 'number') {
          throw new Error('expected number seq value');
        }

        afterSeq = value;
        return query;
      },
      orderBy: (column: string, direction: 'asc' | 'desc') => {
        assert.equal(column, 'seq');
        order = direction;
        return query;
      },
      limit: (limit: number) => {
        limitCount = limit;
        return query;
      },
      executeTakeFirst: async () => {
        if (!conversationId) {
          throw new Error('missing conversation_id message lookup filter');
        }

        if (clientMessageId !== undefined) {
          if (sender !== 'visitor') {
            throw new Error('missing visitor message replay sender filter');
          }

          messageClientMessageLookups.push({ conversationId, clientMessageId });
          return messages.find(
            (message) =>
              message.conversation_id === conversationId &&
              message.client_message_id === clientMessageId &&
              message.sender === 'visitor',
          );
        }

        assert.equal(order, 'desc');
        assert.equal(limitCount, 1);
        messageSeqLookups.push(conversationId);
        return sortedMessages(conversationId, afterSeq, order)[0];
      },
      execute: async () => {
        if (!conversationId) {
          throw new Error('missing conversation_id message lookup filter');
        }

        assert.equal(order, 'asc');
        assert.equal(limitCount, undefined);
        messageReadLookups.push({
          conversationId,
          ...(afterSeq === undefined ? {} : { afterSeq }),
        });
        return sortedMessages(conversationId, afterSeq, order);
      },
    };

    return query;
  }

  function sortedMessages(conversationId: string, afterSeq: number | undefined, order: 'asc' | 'desc') {
    return messages
      .filter((message) => message.conversation_id === conversationId)
      .filter((message) => afterSeq === undefined || message.seq > afterSeq)
      .sort((left, right) => (order === 'asc' ? left.seq - right.seq : right.seq - left.seq));
  }

  function createMessageInsertQuery(tableName: string) {
    assert.equal(tableName, 'messages');
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
      executeTakeFirst: async () => executeInsert(),
      executeTakeFirstOrThrow: async () => {
        const row = await executeInsert();

        if (!row) {
          throw new Error('message insert returned no row');
        }

        return row;
      },
    };

    function executeInsert(): StoredMessage | undefined {
      if (!pendingValues) {
        throw new Error('missing message insert values');
      }

      if (
        visitorInsertRaceMessage &&
        pendingValues.sender === 'visitor' &&
        visitorInsertRaceMessage.conversation_id === pendingValues.conversation_id &&
        visitorInsertRaceMessage.client_message_id === pendingValues.client_message_id
      ) {
        messages.push(visitorInsertRaceMessage);
        visitorInsertRaceMessage = undefined;
      }

      const duplicateVisitorMessage = pendingValues.sender === 'visitor'
        ? messages.find(
            (message) =>
              message.conversation_id === pendingValues?.conversation_id &&
              message.client_message_id === pendingValues?.client_message_id &&
              message.client_message_id !== null,
          )
        : undefined;

      if (duplicateVisitorMessage) {
        assert.deepEqual(conflictTarget, {
          columns: ['conversation_id', 'client_message_id'],
          where: { column: 'client_message_id', operator: 'is not', value: null },
        });
        assert.equal(doNothingOnConflict, true);

        operationLog.push('insert:message:visitor_conflict');
        return undefined;
      }

      operationLog.push(`insert:message:${pendingValues.sender}`);
      messageInserts.push(pendingValues);
      const newMessage = {
        id: `message-${messages.length + 1}`,
        ...pendingValues,
      };
      messages.push(newMessage);

      return newMessage;
    }

    return query;
  }

  function createPandaDeliveryIntentInsertQuery(tableName: string) {
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
            deliveryIntentConflictColumns.push(column);

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
          throw new Error('missing panda delivery intent insert values');
        }

        assert.equal(conflictColumn, 'visitor_message_id');

        if (options.intentInsertError) {
          operationLog.push('insert:intent:fail');
          throw options.intentInsertError;
        }

        operationLog.push('insert:intent');
        deliveryIntentInserts.push(pendingValues);

        if (deliveryIntents.some((intent) => intent.visitor_message_id === pendingValues?.visitor_message_id)) {
          return undefined;
        }

        const newIntent = {
          id: `intent-${deliveryIntents.length + 1}`,
          ...pendingValues,
        };
        deliveryIntents.push(newIntent);

        return { id: newIntent.id };
      },
    };

    return query;
  }

  const database = {
    transaction: () => ({
      execute: async (callback: (transaction: DatabaseClient) => Promise<unknown>) => {
        transactions += 1;
        operationLog.push('transaction:start');

        try {
          const result = await callback(database as unknown as DatabaseClient);
          operationLog.push('transaction:commit');

          return result;
        } catch (error) {
          operationLog.push('transaction:rollback');
          throw error;
        }
      },
    }),
    insertInto: (table: string) => {
      if (table === 'messages') {
        return createMessageInsertQuery(table);
      }

      if (table === 'panda_delivery_intents') {
        return createPandaDeliveryIntentInsertQuery(table);
      }

      throw new Error(`Unexpected insert table: ${table}`);
    },
    selectFrom: (table: string) => {
      if (table === 'widgets') {
        return widgetQuery;
      }

      if (table === 'allowed_domains') {
        return allowedDomainsQuery;
      }

      if (table === 'visitor_sessions') {
        return createVisitorSessionSelectQuery();
      }

      if (table === 'conversations') {
        return createConversationSelectQuery();
      }

      if (table === 'messages') {
        return createMessageSelectQuery();
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as DatabaseClient;

  return {
    database,
    publicKeyLookups,
    allowedDomainWidgetLookups,
    enabledDomainFilters,
    visitorSessionLookups,
    conversationLookups,
    messageSeqLookups,
    messageClientMessageLookups,
    messageReadLookups,
    messageInserts,
    messageInsertConflictTargets,
    get messageInsertConflictDoNothingCount() {
      return messageInsertConflictDoNothingCount;
    },
    deliveryIntentConflictColumns,
    deliveryIntentInserts,
    deliveryIntents,
    messages,
    operationLog,
    get transactions() {
      return transactions;
    },
  };
}

function createEnabledFakeDatabase(options: FakeDatabaseOptions = {}): FakeDatabase {
  const fakeOptions: FakeDatabaseOptions = {
    widget: options.widget ?? enabledDemoWidget(),
    allowedDomains: options.allowedDomains ?? [{ domain: 'localhost', enabled: true }],
    visitorSessions: options.visitorSessions ?? [
      { id: VISITOR_SESSION_ID_A, widget_id: 'widget-id' },
      { id: VISITOR_SESSION_ID_B, widget_id: 'widget-id' },
    ],
    conversations: options.conversations ?? [
      {
        id: CONVERSATION_ID_A,
        widget_id: 'widget-id',
        visitor_session_id: VISITOR_SESSION_ID_A,
        status: 'open',
      },
      {
        id: CONVERSATION_ID_B,
        widget_id: 'widget-id',
        visitor_session_id: VISITOR_SESSION_ID_B,
        status: 'open',
      },
    ],
  };

  if (options.messages) {
    fakeOptions.messages = options.messages;
  }

  if (options.deliveryIntents) {
    fakeOptions.deliveryIntents = options.deliveryIntents;
  }

  if (options.intentInsertError) {
    fakeOptions.intentInsertError = options.intentInsertError;
  }

  if (options.visitorInsertRaceMessage) {
    fakeOptions.visitorInsertRaceMessage = options.visitorInsertRaceMessage;
  }

  return createFakeDatabase(fakeOptions);
}

test('POST /api/widgets/:publicKey/messages stores a visitor message then a fake agent reply', async () => {
  const fake = createEnabledFakeDatabase({
    messages: [
      messageRow({
        id: 'message-1',
        conversationId: CONVERSATION_ID_A,
        seq: 1,
        body: 'Existing',
        clientMessageId: 'existing-client-message',
      }),
    ],
  });
  const messageEvents = createConversationMessageEventEmitter();
  const emittedMessages: Array<{ event: string; seq: number; sender: string; clientMessageId: string | null; body: string }> = [];
  const subscription = messageEvents.subscribe(CONVERSATION_ID_A, (event) => {
    fake.operationLog.push(`emit:${event.message.sender}:${event.message.seq}`);
    emittedMessages.push({
      event: event.event,
      seq: event.message.seq,
      sender: event.message.sender,
      clientMessageId: event.message.clientMessageId,
      body: event.message.body,
    });
  });
  const app = buildApp({ database: fake.database, messageEvents });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
      headers: { origin: 'http://localhost:5173' },
      payload: {
        visitorSessionId: VISITOR_SESSION_ID_A,
        conversationId: CONVERSATION_ID_A,
        clientMessageId: ' client-message-1 ',
        body: ' Hello from visitor ',
      },
    });

    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(Object.keys(body), ['message']);
    assertNoPandaConnectionFields(body);
    assert.equal(typeof body.message.createdAt, 'string');
    assert.deepEqual({ ...body.message, createdAt: '<iso-date>' }, {
      id: 'message-2',
      conversationId: CONVERSATION_ID_A,
      seq: 2,
      sender: 'visitor',
      clientMessageId: 'client-message-1',
      body: 'Hello from visitor',
      createdAt: '<iso-date>',
    });
    assert.deepEqual(fake.publicKeyLookups, [DEMO_SEED_DATA.publicWidgetKey]);
    assert.deepEqual(fake.allowedDomainWidgetLookups, ['widget-id']);
    assert.deepEqual(fake.enabledDomainFilters, [true]);
    assert.deepEqual(fake.visitorSessionLookups, [{ id: VISITOR_SESSION_ID_A, widgetId: 'widget-id' }]);
    assert.deepEqual(fake.conversationLookups, [
      { id: CONVERSATION_ID_A, widgetId: 'widget-id', visitorSessionId: VISITOR_SESSION_ID_A },
    ]);
    assert.deepEqual(fake.messageClientMessageLookups, [
      { conversationId: CONVERSATION_ID_A, clientMessageId: 'client-message-1' },
    ]);
    assert.deepEqual(fake.messageSeqLookups, [CONVERSATION_ID_A, CONVERSATION_ID_A]);
    assert.deepEqual(
      fake.messageInserts.map((values) => ({
        conversation_id: values.conversation_id,
        seq: values.seq,
        sender: values.sender,
        client_message_id: values.client_message_id,
        body: values.body,
      })),
      [
        {
          conversation_id: CONVERSATION_ID_A,
          seq: 2,
          sender: 'visitor',
          client_message_id: 'client-message-1',
          body: 'Hello from visitor',
        },
        {
          conversation_id: CONVERSATION_ID_A,
          seq: 3,
          sender: 'agent',
          client_message_id: null,
          body: createFakeResponderReply({ visitorMessage: { body: 'Hello from visitor' } }).body,
        },
      ],
    );
    assert.deepEqual(
      fake.deliveryIntentInserts.map((values) => ({
        widget_id: values.widget_id,
        conversation_id: values.conversation_id,
        visitor_session_id: values.visitor_session_id,
        visitor_message_id: values.visitor_message_id,
        client_message_id: values.client_message_id,
        route_handle_snapshot: values.route_handle_snapshot,
        status: values.status,
      })),
      [
        {
          widget_id: 'widget-id',
          conversation_id: CONVERSATION_ID_A,
          visitor_session_id: VISITOR_SESSION_ID_A,
          visitor_message_id: 'message-2',
          client_message_id: 'client-message-1',
          route_handle_snapshot: 'panda:workspace/alpha',
          status: 'queued',
        },
      ],
    );
    assert.deepEqual(fake.deliveryIntentConflictColumns, ['visitor_message_id']);
    assert.equal(fake.deliveryIntents.length, 1);
    assert.deepEqual(emittedMessages, [
      {
        event: 'message',
        seq: 2,
        sender: 'visitor',
        clientMessageId: 'client-message-1',
        body: 'Hello from visitor',
      },
      {
        event: 'message',
        seq: 3,
        sender: 'agent',
        clientMessageId: null,
        body: createFakeResponderReply({ visitorMessage: { body: 'Hello from visitor' } }).body,
      },
    ]);
    assert.equal(fake.transactions, 1);
    assert.deepEqual(fake.operationLog, [
      'transaction:start',
      'insert:message:visitor',
      'insert:intent',
      'insert:message:agent',
      'transaction:commit',
      'emit:visitor:2',
      'emit:agent:3',
    ]);
  } finally {
    subscription.close();
    await app.close();
  }
});


test('POST /api/widgets/:publicKey/messages skips delivery intents for unconfigured widgets but keeps fake replies', async () => {
  const fake = createEnabledFakeDatabase({
    widget: { ...enabledDemoWidget(), panda_route_handle: null },
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
      headers: { origin: 'http://localhost:5173' },
      payload: validMessagePayload(),
    });

    assert.equal(response.statusCode, 200);
    assertNoPandaConnectionFields(response.json());
    assert.deepEqual(fake.deliveryIntentInserts, []);
    assert.deepEqual(fake.deliveryIntents, []);
    assert.deepEqual(
      fake.messageInserts.map((values) => ({ sender: values.sender, seq: values.seq, body: values.body })),
      [
        { sender: 'visitor', seq: 1, body: 'Hello from visitor' },
        {
          sender: 'agent',
          seq: 2,
          body: createFakeResponderReply({ visitorMessage: { body: 'Hello from visitor' } }).body,
        },
      ],
    );
    assert.equal(fake.transactions, 1);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/messages does not emit uncommitted messages when intent recording fails', async () => {
  const fake = createEnabledFakeDatabase({ intentInsertError: new Error('intent insert failed') });
  const messageEvents = createConversationMessageEventEmitter();
  const emittedMessages: Array<{ sender: string; seq: number }> = [];
  const subscription = messageEvents.subscribe(CONVERSATION_ID_A, (event) => {
    fake.operationLog.push(`emit:${event.message.sender}:${event.message.seq}`);
    emittedMessages.push({ sender: event.message.sender, seq: event.message.seq });
  });
  const app = buildApp({ database: fake.database, messageEvents });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
      headers: { origin: 'http://localhost:5173' },
      payload: validMessagePayload(),
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'internal_server_error' });
    assert.deepEqual(emittedMessages, []);
    assert.deepEqual(fake.deliveryIntentInserts, []);
    assert.deepEqual(
      fake.messageInserts.map((values) => ({ sender: values.sender, seq: values.seq, body: values.body })),
      [{ sender: 'visitor', seq: 1, body: 'Hello from visitor' }],
    );
    assert.equal(fake.transactions, 1);
    assert.deepEqual(fake.operationLog, [
      'transaction:start',
      'insert:message:visitor',
      'insert:intent:fail',
      'transaction:rollback',
    ]);
  } finally {
    subscription.close();
    await app.close();
  }
});


test('public message routes reject invalid public keys before lookup or writes', async () => {
  const query = new URLSearchParams({
    visitorSessionId: VISITOR_SESSION_ID_A,
    conversationId: CONVERSATION_ID_A,
  });
  const cases = [
    { method: 'POST', url: '/api/widgets/%20/messages', payload: validMessagePayload() },
    { method: 'GET', url: `/api/widgets/%20/messages?${query}` },
    { method: 'GET', url: `/api/widgets/%20/messages/events?${query}` },
  ] as const;

  for (const request of cases) {
    const fake = createEnabledFakeDatabase();
    const app = buildApp({ database: fake.database });

    try {
      const response = await app.inject(
        'payload' in request
          ? {
              method: request.method,
              url: request.url,
              headers: { origin: 'http://localhost:5173' },
              payload: request.payload,
            }
          : {
              method: request.method,
              url: request.url,
              headers: { origin: 'http://localhost:5173' },
            },
      );

      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.json(), { error: 'invalid_widget_request', reason: 'missing_public_key' });
      assert.deepEqual(fake.publicKeyLookups, []);
      assert.deepEqual(fake.visitorSessionLookups, []);
      assert.deepEqual(fake.conversationLookups, []);
      assert.deepEqual(fake.messageReadLookups, []);
      assert.deepEqual(fake.messageInserts, []);
    } finally {
      await app.close();
    }
  }
});

test('POST /api/widgets/:publicKey/messages rate-limit hook can reject before message inserts', async () => {
  const fake = createEnabledFakeDatabase();
  const rateLimitInputs: PublicWriteRateLimitInput[] = [];
  const app = buildApp({
    database: fake.database,
    publicWriteRateLimit: (input) => {
      rateLimitInputs.push(input);
      return { allowed: false, reason: 'too_many_requests' };
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
      headers: { origin: 'http://localhost:5173' },
      payload: validMessagePayload(),
    });

    assert.equal(response.statusCode, 429);
    assert.deepEqual(response.json(), { error: 'rate_limited', reason: 'too_many_requests' });
    assert.deepEqual(rateLimitInputs, [{
      route: 'message_create',
      publicKey: DEMO_SEED_DATA.publicWidgetKey,
      visitorSessionId: VISITOR_SESSION_ID_A,
      conversationId: CONVERSATION_ID_A,
      clientMessageId: 'client-message-1',
    }]);
    assert.deepEqual(fake.messageInserts, []);
    assert.deepEqual(fake.deliveryIntentInserts, []);
    assert.deepEqual(fake.messages, []);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/messages replays the original visitor message for duplicate client ids', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const firstResponse = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
      headers: { origin: 'http://localhost:5173' },
      payload: validMessagePayload(),
    });
    const retryResponse = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
      headers: { origin: 'http://localhost:5173' },
      payload: { ...validMessagePayload(), body: 'Conflicting retry body' },
    });

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(retryResponse.statusCode, 200);
    assert.deepEqual(
      { ...retryResponse.json().message, createdAt: '<iso-date>' },
      { ...firstResponse.json().message, createdAt: '<iso-date>' },
    );
    assert.equal(retryResponse.json().message.body, 'Hello from visitor');
    assert.deepEqual(fake.messageClientMessageLookups, [
      { conversationId: CONVERSATION_ID_A, clientMessageId: 'client-message-1' },
      { conversationId: CONVERSATION_ID_A, clientMessageId: 'client-message-1' },
    ]);
    assert.deepEqual(fake.messageSeqLookups, [CONVERSATION_ID_A, CONVERSATION_ID_A]);
    assert.deepEqual(
      fake.messageInserts.map((values) => ({ sender: values.sender, seq: values.seq, body: values.body })),
      [
        { sender: 'visitor', seq: 1, body: 'Hello from visitor' },
        {
          sender: 'agent',
          seq: 2,
          body: createFakeResponderReply({ visitorMessage: { body: 'Hello from visitor' } }).body,
        },
      ],
    );
    assert.deepEqual(
      fake.deliveryIntentInserts.map((values) => ({
        visitor_message_id: values.visitor_message_id,
        client_message_id: values.client_message_id,
        route_handle_snapshot: values.route_handle_snapshot,
        status: values.status,
      })),
      [
        {
          visitor_message_id: 'message-1',
          client_message_id: 'client-message-1',
          route_handle_snapshot: 'panda:workspace/alpha',
          status: 'queued',
        },
      ],
    );
    assert.equal(fake.transactions, 2);
  } finally {
    await app.close();
  }
});


test('POST /api/widgets/:publicKey/messages replays concurrent duplicate visitor inserts without fake reply or intent', async () => {
  const fake = createEnabledFakeDatabase({
    visitorInsertRaceMessage: messageRow({
      id: 'message-race',
      conversationId: CONVERSATION_ID_A,
      seq: 1,
      clientMessageId: 'client-message-1',
      body: 'Original body',
    }),
  });
  const messageEvents = createConversationMessageEventEmitter();
  const emittedMessages: Array<{ sender: string; seq: number }> = [];
  const subscription = messageEvents.subscribe(CONVERSATION_ID_A, (event) => {
    emittedMessages.push({ sender: event.message.sender, seq: event.message.seq });
  });
  const app = buildApp({ database: fake.database, messageEvents });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
      headers: { origin: 'http://localhost:5173' },
      payload: { ...validMessagePayload(), body: 'Conflicting retry body' },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual({ ...response.json().message, createdAt: '<iso-date>' }, {
      id: 'message-race',
      conversationId: CONVERSATION_ID_A,
      seq: 1,
      sender: 'visitor',
      clientMessageId: 'client-message-1',
      body: 'Original body',
      createdAt: '<iso-date>',
    });
    assertNoPandaConnectionFields(response.json());
    assert.deepEqual(fake.messageClientMessageLookups, [
      { conversationId: CONVERSATION_ID_A, clientMessageId: 'client-message-1' },
      { conversationId: CONVERSATION_ID_A, clientMessageId: 'client-message-1' },
    ]);
    assert.deepEqual(fake.messageSeqLookups, [CONVERSATION_ID_A]);
    assert.deepEqual(fake.messageInserts, []);
    assert.deepEqual(fake.deliveryIntentInserts, []);
    assert.deepEqual(emittedMessages, []);
    assert.deepEqual(fake.messageInsertConflictTargets, [
      {
        columns: ['conversation_id', 'client_message_id'],
        where: { column: 'client_message_id', operator: 'is not', value: null },
      },
    ]);
    assert.equal(fake.messageInsertConflictDoNothingCount, 1);
    assert.deepEqual(fake.operationLog, [
      'transaction:start',
      'insert:message:visitor_conflict',
      'transaction:commit',
    ]);
  } finally {
    subscription.close();
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/messages scopes duplicate client ids to a conversation', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const firstResponse = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
      headers: { origin: 'http://localhost:5173' },
      payload: validMessagePayload(),
    });
    const secondConversationResponse = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
      headers: { origin: 'http://localhost:5173' },
      payload: {
        visitorSessionId: VISITOR_SESSION_ID_B,
        conversationId: CONVERSATION_ID_B,
        clientMessageId: 'client-message-1',
        body: 'Same client id in another conversation',
      },
    });

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondConversationResponse.statusCode, 200);
    assert.deepEqual(
      [firstResponse.json().message, secondConversationResponse.json().message].map(
        (message: { conversationId: string; seq: number; clientMessageId: string; body: string }) => ({
          conversationId: message.conversationId,
          seq: message.seq,
          clientMessageId: message.clientMessageId,
          body: message.body,
        }),
      ),
      [
        {
          conversationId: CONVERSATION_ID_A,
          seq: 1,
          clientMessageId: 'client-message-1',
          body: 'Hello from visitor',
        },
        {
          conversationId: CONVERSATION_ID_B,
          seq: 1,
          clientMessageId: 'client-message-1',
          body: 'Same client id in another conversation',
        },
      ],
    );
    assert.deepEqual(fake.messageClientMessageLookups, [
      { conversationId: CONVERSATION_ID_A, clientMessageId: 'client-message-1' },
      { conversationId: CONVERSATION_ID_B, clientMessageId: 'client-message-1' },
    ]);
    assert.deepEqual(fake.messageSeqLookups, [
      CONVERSATION_ID_A,
      CONVERSATION_ID_A,
      CONVERSATION_ID_B,
      CONVERSATION_ID_B,
    ]);
    assert.deepEqual(
      fake.messageInserts.map((values) => ({
        conversation_id: values.conversation_id,
        seq: values.seq,
        sender: values.sender,
        body: values.body,
      })),
      [
        {
          conversation_id: CONVERSATION_ID_A,
          seq: 1,
          sender: 'visitor',
          body: 'Hello from visitor',
        },
        {
          conversation_id: CONVERSATION_ID_A,
          seq: 2,
          sender: 'agent',
          body: createFakeResponderReply({ visitorMessage: { body: 'Hello from visitor' } }).body,
        },
        {
          conversation_id: CONVERSATION_ID_B,
          seq: 1,
          sender: 'visitor',
          body: 'Same client id in another conversation',
        },
        {
          conversation_id: CONVERSATION_ID_B,
          seq: 2,
          sender: 'agent',
          body: createFakeResponderReply({
            visitorMessage: { body: 'Same client id in another conversation' },
          }).body,
        },
      ],
    );
    assert.deepEqual(
      fake.deliveryIntentInserts.map((values) => ({
        conversation_id: values.conversation_id,
        visitor_session_id: values.visitor_session_id,
        visitor_message_id: values.visitor_message_id,
        client_message_id: values.client_message_id,
      })),
      [
        {
          conversation_id: CONVERSATION_ID_A,
          visitor_session_id: VISITOR_SESSION_ID_A,
          visitor_message_id: 'message-1',
          client_message_id: 'client-message-1',
        },
        {
          conversation_id: CONVERSATION_ID_B,
          visitor_session_id: VISITOR_SESSION_ID_B,
          visitor_message_id: 'message-3',
          client_message_id: 'client-message-1',
        },
      ],
    );
  } finally {
    await app.close();
  }
});


test('GET /api/widgets/:publicKey/messages returns inserted visitor message then fake reply', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const postResponse = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
      headers: { origin: 'http://localhost:5173' },
      payload: validMessagePayload(),
    });

    const postMessage = postResponse.json().message;

    const listResponse = await app.inject({
      method: 'GET',
      url: messageListUrl(),
      headers: { origin: 'http://localhost:5173' },
    });
    const afterVisitorResponse = await app.inject({
      method: 'GET',
      url: `${messageListUrl()}&afterSeq=${postMessage.seq}`,
      headers: { origin: 'http://localhost:5173' },
    });
    const afterReplyResponse = await app.inject({
      method: 'GET',
      url: `${messageListUrl()}&afterSeq=${postMessage.seq + 1}`,
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(postResponse.statusCode, 200);
    assert.equal(listResponse.statusCode, 200);
    assert.equal(afterVisitorResponse.statusCode, 200);
    assert.equal(afterReplyResponse.statusCode, 200);
    assertNoPandaConnectionFields(listResponse.json());
    assertNoPandaConnectionFields(afterVisitorResponse.json());
    assertNoPandaConnectionFields(afterReplyResponse.json());
    assert.deepEqual(
      listResponse.json().messages.map((message: { seq: number; sender: string; clientMessageId: string | null; body: string }) => ({
        seq: message.seq,
        sender: message.sender,
        clientMessageId: message.clientMessageId,
        body: message.body,
      })),
      [
        {
          seq: 1,
          sender: 'visitor',
          clientMessageId: 'client-message-1',
          body: 'Hello from visitor',
        },
        {
          seq: 2,
          sender: 'agent',
          clientMessageId: null,
          body: createFakeResponderReply({ visitorMessage: { body: 'Hello from visitor' } }).body,
        },
      ],
    );
    assert.deepEqual(
      afterVisitorResponse.json().messages.map((message: { seq: number; sender: string; body: string }) => ({
        seq: message.seq,
        sender: message.sender,
        body: message.body,
      })),
      [
        {
          seq: 2,
          sender: 'agent',
          body: createFakeResponderReply({ visitorMessage: { body: 'Hello from visitor' } }).body,
        },
      ],
    );
    assert.deepEqual(afterReplyResponse.json().messages, []);
    assert.deepEqual(fake.messageReadLookups, [
      { conversationId: CONVERSATION_ID_A },
      { conversationId: CONVERSATION_ID_A, afterSeq: 1 },
      { conversationId: CONVERSATION_ID_A, afterSeq: 2 },
    ]);
    assert.equal(fake.messageInserts.length, 2);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/messages returns conversation messages in seq order', async () => {
  const fake = createEnabledFakeDatabase({
    messages: [
      messageRow({ id: 'message-3', conversationId: CONVERSATION_ID_A, seq: 3, body: 'Third' }),
      messageRow({ id: 'other-message-1', conversationId: CONVERSATION_ID_B, seq: 1, body: 'Other' }),
      messageRow({ id: 'message-1', conversationId: CONVERSATION_ID_A, seq: 1, body: 'First' }),
      messageRow({ id: 'message-2', conversationId: CONVERSATION_ID_A, seq: 2, body: 'Second' }),
    ],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: messageListUrl(),
      headers: { origin: 'http://localhost:5173' },
    });

    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      body.messages.map((message: { id: string; seq: number; body: string; createdAt: string }) => ({
        id: message.id,
        seq: message.seq,
        body: message.body,
        createdAtType: typeof message.createdAt,
      })),
      [
        { id: 'message-1', seq: 1, body: 'First', createdAtType: 'string' },
        { id: 'message-2', seq: 2, body: 'Second', createdAtType: 'string' },
        { id: 'message-3', seq: 3, body: 'Third', createdAtType: 'string' },
      ],
    );
    assert.deepEqual(fake.visitorSessionLookups, [{ id: VISITOR_SESSION_ID_A, widgetId: 'widget-id' }]);
    assert.deepEqual(fake.conversationLookups, [
      { id: CONVERSATION_ID_A, widgetId: 'widget-id', visitorSessionId: VISITOR_SESSION_ID_A },
    ]);
    assert.deepEqual(fake.messageReadLookups, [{ conversationId: CONVERSATION_ID_A }]);
    assert.deepEqual(fake.messageInserts, []);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/messages filters messages after seq', async () => {
  const fake = createEnabledFakeDatabase({
    messages: [
      messageRow({ id: 'message-1', conversationId: CONVERSATION_ID_A, seq: 1, body: 'First' }),
      messageRow({ id: 'message-3', conversationId: CONVERSATION_ID_A, seq: 3, body: 'Third' }),
      messageRow({ id: 'message-2', conversationId: CONVERSATION_ID_A, seq: 2, body: 'Second' }),
    ],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: `${messageListUrl()}&afterSeq=1`,
      headers: { origin: 'http://localhost:5173' },
    });

    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      body.messages.map((message: { id: string; seq: number; body: string }) => ({
        id: message.id,
        seq: message.seq,
        body: message.body,
      })),
      [
        { id: 'message-2', seq: 2, body: 'Second' },
        { id: 'message-3', seq: 3, body: 'Third' },
      ],
    );
    assert.deepEqual(fake.messageReadLookups, [{ conversationId: CONVERSATION_ID_A, afterSeq: 1 }]);
    assert.deepEqual(fake.messageInserts, []);
  } finally {
    await app.close();
  }
});


test('GET /api/widgets/:publicKey/messages/events treats afterSeq as reconnect catch-up without leaking conversations', async () => {
  const fake = createEnabledFakeDatabase({
    messages: [
      messageRow({ id: 'message-3', conversationId: CONVERSATION_ID_A, seq: 3, body: 'Follow-up' }),
      messageRow({ id: 'other-message-1', conversationId: CONVERSATION_ID_B, seq: 4, body: 'Other conversation' }),
      messageRow({ id: 'message-1', conversationId: CONVERSATION_ID_A, seq: 1, body: 'Already read' }),
      messageRow({ id: 'message-2', conversationId: CONVERSATION_ID_A, seq: 2, sender: 'agent', body: 'Fake reply' }),
    ],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: `${messageEventsUrl()}&afterSeq=1`,
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type']), /^text\/event-stream/);
    assertNoPandaConnectionFields(response.body);
    assert.equal(response.headers['cache-control'], 'no-cache, no-transform');
    assert.equal(response.headers.connection, 'keep-alive');
    assert.deepEqual(
      parseServerSentEvents(response.body).map((event) => {
        const data = event.data as { message: { seq: number; sender: string; body: string } };

        return {
          event: event.event,
          seq: data.message.seq,
          sender: data.message.sender,
          body: data.message.body,
        };
      }),
      [
        { event: 'message', seq: 2, sender: 'agent', body: 'Fake reply' },
        { event: 'message', seq: 3, sender: 'visitor', body: 'Follow-up' },
      ],
    );
    assert.doesNotMatch(response.body, /Other conversation/);
    assert.deepEqual(fake.messageReadLookups, [{ conversationId: CONVERSATION_ID_A, afterSeq: 1 }]);
    assert.deepEqual(fake.messageInserts, []);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/messages/events returns a ready event when no messages are missed', async () => {
  const fake = createEnabledFakeDatabase({
    messages: [messageRow({ id: 'message-1', conversationId: CONVERSATION_ID_A, seq: 1, body: 'Already read' })],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: `${messageEventsUrl()}&afterSeq=1`,
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type']), /^text\/event-stream/);
    assertNoPandaConnectionFields(response.body);
    assert.deepEqual(parseServerSentEvents(response.body), [{ event: 'ready', data: {} }]);
    assert.deepEqual(fake.messageReadLookups, [{ conversationId: CONVERSATION_ID_A, afterSeq: 1 }]);
    assert.deepEqual(fake.messageInserts, []);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/messages/events rejects missing or invalid query before lookup', async () => {
  const cases = [
    [`/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages/events?conversationId=${CONVERSATION_ID_A}`, 'missing_visitor_session_id'],
    [
      `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages/events?visitorSessionId=${VISITOR_SESSION_ID_A}&conversationId=`,
      'missing_conversation_id',
    ],
    [`${messageEventsUrl()}&afterSeq=-1`, 'invalid_after_seq'],
    [`${messageEventsUrl()}&afterSeq=1.5`, 'invalid_after_seq'],
    [`${messageEventsUrl()}&afterSeq=abc`, 'invalid_after_seq'],
  ] as const;

  for (const [url, reason] of cases) {
    const fake = createEnabledFakeDatabase();
    const app = buildApp({ database: fake.database });

    try {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { origin: 'http://localhost:5173' },
      });

      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.json(), { error: 'invalid_message_request', reason });
      assert.deepEqual(fake.publicKeyLookups, []);
      assert.deepEqual(fake.messageReadLookups, []);
      assert.deepEqual(fake.messageInserts, []);
    } finally {
      await app.close();
    }
  }
});

test('GET /api/widgets/:publicKey/messages/events rejects visitor sessions outside the widget before streaming', async () => {
  const fake = createEnabledFakeDatabase({
    visitorSessions: [{ id: VISITOR_SESSION_ID_A, widget_id: 'other-widget-id' }],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: messageEventsUrl(),
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'visitor_session_not_found' });
    assert.deepEqual(fake.conversationLookups, []);
    assert.deepEqual(fake.messageReadLookups, []);
    assert.deepEqual(fake.messageInserts, []);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/messages/events rejects conversations outside the visitor session before streaming', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: messageEventsUrl({ conversationId: CONVERSATION_ID_B }),
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'conversation_not_found' });
    assert.deepEqual(fake.conversationLookups, [
      { id: CONVERSATION_ID_B, widgetId: 'widget-id', visitorSessionId: VISITOR_SESSION_ID_A },
    ]);
    assert.deepEqual(fake.messageReadLookups, []);
    assert.deepEqual(fake.messageInserts, []);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/messages/events rejects closed conversations before streaming', async () => {
  const fake = createEnabledFakeDatabase({
    conversations: [
      {
        id: CONVERSATION_ID_A,
        widget_id: 'widget-id',
        visitor_session_id: VISITOR_SESSION_ID_A,
        status: 'closed',
      },
    ],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: messageEventsUrl(),
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'conversation_closed' });
    assert.deepEqual(fake.messageReadLookups, []);
    assert.deepEqual(fake.messageInserts, []);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/messages/events rejects disallowed origins before streaming', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: messageEventsUrl(),
      headers: { origin: 'https://example.com' },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'origin_not_allowed', reason: 'domain_not_allowed' });
    assert.deepEqual(fake.visitorSessionLookups, []);
    assert.deepEqual(fake.messageReadLookups, []);
    assert.deepEqual(fake.messageInserts, []);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/messages rejects missing or invalid query before lookup', async () => {
  const cases = [
    [`/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages?conversationId=${CONVERSATION_ID_A}`, 'missing_visitor_session_id'],
    [
      `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages?visitorSessionId=${VISITOR_SESSION_ID_A}&conversationId=`,
      'missing_conversation_id',
    ],
    [`${messageListUrl()}&afterSeq=-1`, 'invalid_after_seq'],
    [`${messageListUrl()}&afterSeq=1.5`, 'invalid_after_seq'],
    [`${messageListUrl()}&afterSeq=abc`, 'invalid_after_seq'],
  ] as const;

  for (const [url, reason] of cases) {
    const fake = createEnabledFakeDatabase();
    const app = buildApp({ database: fake.database });

    try {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { origin: 'http://localhost:5173' },
      });

      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.json(), { error: 'invalid_message_request', reason });
      assert.deepEqual(fake.publicKeyLookups, []);
      assert.deepEqual(fake.messageReadLookups, []);
      assert.deepEqual(fake.messageInserts, []);
    } finally {
      await app.close();
    }
  }
});

test('GET /api/widgets/:publicKey/messages rejects visitor sessions outside the widget before read', async () => {
  const fake = createEnabledFakeDatabase({
    visitorSessions: [{ id: VISITOR_SESSION_ID_A, widget_id: 'other-widget-id' }],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: messageListUrl(),
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'visitor_session_not_found' });
    assert.deepEqual(fake.conversationLookups, []);
    assert.deepEqual(fake.messageReadLookups, []);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/messages rejects conversations outside the visitor session before read', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: messageListUrl({ conversationId: CONVERSATION_ID_B }),
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'conversation_not_found' });
    assert.deepEqual(fake.conversationLookups, [
      { id: CONVERSATION_ID_B, widgetId: 'widget-id', visitorSessionId: VISITOR_SESSION_ID_A },
    ]);
    assert.deepEqual(fake.messageReadLookups, []);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/messages rejects closed conversations before read', async () => {
  const fake = createEnabledFakeDatabase({
    conversations: [
      {
        id: CONVERSATION_ID_A,
        widget_id: 'widget-id',
        visitor_session_id: VISITOR_SESSION_ID_A,
        status: 'closed',
      },
    ],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: messageListUrl(),
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'conversation_closed' });
    assert.deepEqual(fake.messageReadLookups, []);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/messages rejects disallowed origins before read', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: messageListUrl(),
      headers: { origin: 'https://example.com' },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'origin_not_allowed', reason: 'domain_not_allowed' });
    assert.deepEqual(fake.visitorSessionLookups, []);
    assert.deepEqual(fake.messageReadLookups, []);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/messages rejects missing or invalid request fields before lookup', async () => {
  const cases = [
    [{ conversationId: CONVERSATION_ID_A, clientMessageId: 'client-message', body: 'Hello' }, 'missing_visitor_session_id'],
    [
      {
        visitorSessionId: VISITOR_SESSION_ID_A,
        conversationId: '   ',
        clientMessageId: 'client-message',
        body: 'Hello',
      },
      'missing_conversation_id',
    ],
    [
      {
        visitorSessionId: VISITOR_SESSION_ID_A,
        conversationId: CONVERSATION_ID_A,
        clientMessageId: 123,
        body: 'Hello',
      },
      'invalid_client_message_id',
    ],
    [
      {
        visitorSessionId: VISITOR_SESSION_ID_A,
        conversationId: CONVERSATION_ID_A,
        clientMessageId: 'client-message',
        body: '',
      },
      'missing_body',
    ],
  ] as const;

  for (const [payload, reason] of cases) {
    const fake = createEnabledFakeDatabase();
    const app = buildApp({ database: fake.database });

    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
        headers: { origin: 'http://localhost:5173' },
        payload,
      });

      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.json(), { error: 'invalid_message_request', reason });
      assert.deepEqual(fake.publicKeyLookups, []);
      assert.deepEqual(fake.messageInserts, []);
    } finally {
      await app.close();
    }
  }
});

test('POST /api/widgets/:publicKey/messages rejects visitor sessions outside the widget before insert', async () => {
  const fake = createEnabledFakeDatabase({
    visitorSessions: [{ id: VISITOR_SESSION_ID_A, widget_id: 'other-widget-id' }],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
      headers: { origin: 'http://localhost:5173' },
      payload: validMessagePayload(),
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'visitor_session_not_found' });
    assert.deepEqual(fake.conversationLookups, []);
    assert.deepEqual(fake.messageInserts, []);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/messages rejects conversations outside the visitor session before insert', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
      headers: { origin: 'http://localhost:5173' },
      payload: { ...validMessagePayload(), conversationId: CONVERSATION_ID_B },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'conversation_not_found' });
    assert.deepEqual(fake.conversationLookups, [
      { id: CONVERSATION_ID_B, widgetId: 'widget-id', visitorSessionId: VISITOR_SESSION_ID_A },
    ]);
    assert.deepEqual(fake.messageInserts, []);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/messages rejects closed conversations before insert', async () => {
  const fake = createEnabledFakeDatabase({
    conversations: [
      {
        id: CONVERSATION_ID_A,
        widget_id: 'widget-id',
        visitor_session_id: VISITOR_SESSION_ID_A,
        status: 'closed',
      },
    ],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
      headers: { origin: 'http://localhost:5173' },
      payload: validMessagePayload(),
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'conversation_closed' });
    assert.deepEqual(fake.messageInserts, []);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/messages rejects disallowed origins before insert', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages`,
      headers: { origin: 'https://example.com' },
      payload: validMessagePayload(),
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'origin_not_allowed', reason: 'domain_not_allowed' });
    assert.deepEqual(fake.visitorSessionLookups, []);
    assert.deepEqual(fake.messageInserts, []);
  } finally {
    await app.close();
  }
});

test('findConversationForVisitorMessage distinguishes open, closed, and wrong-owner conversations', async () => {
  const fake = createEnabledFakeDatabase({
    conversations: [
      {
        id: 'open-conversation',
        widget_id: 'widget-id',
        visitor_session_id: VISITOR_SESSION_ID_A,
        status: 'open',
      },
      {
        id: 'closed-conversation',
        widget_id: 'widget-id',
        visitor_session_id: VISITOR_SESSION_ID_A,
        status: 'closed',
      },
    ],
  });

  assert.deepEqual(await findConversationForVisitorMessage(fake.database, {
    widgetId: 'widget-id',
    visitorSessionId: VISITOR_SESSION_ID_A,
    conversationId: 'open-conversation',
  }), { status: 'open', conversationId: 'open-conversation' });
  assert.deepEqual(await findConversationForVisitorMessage(fake.database, {
    widgetId: 'widget-id',
    visitorSessionId: VISITOR_SESSION_ID_A,
    conversationId: 'closed-conversation',
  }), { status: 'closed' });
  assert.deepEqual(await findConversationForVisitorMessage(fake.database, {
    widgetId: 'widget-id',
    visitorSessionId: VISITOR_SESSION_ID_B,
    conversationId: 'open-conversation',
  }), { status: 'not_found' });
});

test('visitor message route has SSE catch-up, fake reply, and local intent seams without Gateway/CLI/network/worker behavior', () => {
  assert.match(visitorMessageSource, /\/api\/widgets\/:publicKey\/messages/);
  assert.match(visitorMessageSource, /\/api\/widgets\/:publicKey\/messages\/events/);
  assert.match(visitorMessageEventRouteSource, /text\/event-stream/);
  assert.match(visitorMessageEventRouteSource, /serializeVisitorMessageEvents/);
  assert.match(visitorMessageSource, /shouldOpenLiveVisitorMessageEventStream/);
  assert.match(visitorMessageSource, /streamVisitorMessageEvents/);
  assert.match(visitorMessageSource, /reply\.hijack/);
  assert.match(visitorMessageSource, /messageEvents\.emit/);
  assert.match(visitorMessageSource, /createFakeResponderReply/);
  assert.match(visitorMessageSource, /insertVisitorConversationMessage/);
  assert.match(visitorMessageSource, /insertConversationMessage/);
  assert.match(visitorMessageSource, /recordPandaDeliveryIntent/);
  assert.match(visitorMessageSource, /sender: 'agent'/);
  assert.match(visitorMessageSource, /readMessagesForConversation/);
  assert.match(visitorMessageSource, /clientMessageId/);
  assert.doesNotMatch(
    visitorMessageEventRouteSource,
    /sender: 'system'|EventSource|WebSocket|Gateway|\bCLI\b|fetch|child_process|Worker|localStorage|postMessage|setTimeout|setInterval/i,
  );
});


function messageListUrl(options: { visitorSessionId?: string; conversationId?: string } = {}): string {
  const visitorSessionId = options.visitorSessionId ?? VISITOR_SESSION_ID_A;
  const conversationId = options.conversationId ?? CONVERSATION_ID_A;
  const query = new URLSearchParams({ visitorSessionId, conversationId });

  return `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages?${query}`;
}

function messageEventsUrl(options: { visitorSessionId?: string; conversationId?: string } = {}): string {
  const visitorSessionId = options.visitorSessionId ?? VISITOR_SESSION_ID_A;
  const conversationId = options.conversationId ?? CONVERSATION_ID_A;
  const query = new URLSearchParams({ visitorSessionId, conversationId });

  return `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/messages/events?${query}`;
}

type ParsedServerSentEvent = {
  event: string;
  data: unknown;
};

function parseServerSentEvents(body: string): ParsedServerSentEvent[] {
  return body
    .trim()
    .split('\n\n')
    .filter((block) => block.length > 0)
    .map((block) => {
      const [eventLine, dataLine] = block.split('\n');

      if (eventLine === undefined || dataLine === undefined) {
        throw new Error('invalid SSE event block');
      }

      assert.match(eventLine, /^event: /);
      assert.match(dataLine, /^data: /);

      return {
        event: eventLine.slice('event: '.length),
        data: JSON.parse(dataLine.slice('data: '.length)),
      };
    });
}


function validMessagePayload(): Record<string, string> {
  return {
    visitorSessionId: VISITOR_SESSION_ID_A,
    conversationId: CONVERSATION_ID_A,
    clientMessageId: 'client-message-1',
    body: 'Hello from visitor',
  };
}

type MessageRowInput = {
  id: string;
  conversationId: string;
  seq: number;
  sender?: MessageSender;
  clientMessageId?: string | null;
  body?: string;
  createdAt?: Date;
};

function messageRow(input: MessageRowInput): StoredMessage {
  return {
    id: input.id,
    conversation_id: input.conversationId,
    seq: input.seq,
    sender: input.sender ?? 'visitor',
    client_message_id: input.clientMessageId ?? `client-${input.id}`,
    body: input.body ?? input.id,
    created_at: input.createdAt ?? FIRST_CREATED_AT,
  };
}
