import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildApp } from './app.ts';
import type { ConversationStatus, DatabaseClient, MessageSender } from './db.ts';
import type { AllowedDomainRecord } from './origin-domain.ts';
import { DEMO_SEED_DATA } from './seed-data.ts';
import { findConversationForVisitorMessage } from './visitor-message.ts';

type WidgetLookupRow = {
  widgetId: string;
  siteId: string;
  publicKey: string;
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

type FakeDatabaseOptions = {
  widget?: WidgetLookupRow;
  allowedDomains?: AllowedDomainRecord[];
  visitorSessions?: StoredVisitorSession[];
  conversations?: StoredConversation[];
  messages?: StoredMessage[];
};

type FakeDatabase = {
  database: DatabaseClient;
  publicKeyLookups: string[];
  allowedDomainWidgetLookups: string[];
  enabledDomainFilters: boolean[];
  visitorSessionLookups: Array<{ id: string; widgetId: string }>;
  conversationLookups: Array<{ id: string; widgetId: string; visitorSessionId: string }>;
  messageSeqLookups: string[];
  messageInserts: MessageInsertValues[];
  messages: StoredMessage[];
};

const VISITOR_SESSION_ID_A = 'visitor-session-a';
const VISITOR_SESSION_ID_B = 'visitor-session-b';
const CONVERSATION_ID_A = 'conversation-a';
const CONVERSATION_ID_B = 'conversation-b';
const FIRST_CREATED_AT = new Date('2026-01-01T00:00:00Z');
const visitorMessageSource = await readFile(new URL('./visitor-message.ts', import.meta.url), 'utf8');

function enabledDemoWidget(): WidgetLookupRow {
  return {
    widgetId: 'widget-id',
    siteId: 'site-id',
    publicKey: DEMO_SEED_DATA.publicWidgetKey,
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
  const messageInserts: MessageInsertValues[] = [];
  const visitorSessions = [...(options.visitorSessions ?? [])];
  const conversations = [...(options.conversations ?? [])];
  const messages = [...(options.messages ?? [])];

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

    const query = {
      select: () => query,
      where: (column: string, _operator: string, value: string) => {
        assert.equal(column, 'conversation_id');
        conversationId = value;
        return query;
      },
      orderBy: (column: string, direction: 'asc' | 'desc') => {
        assert.equal(column, 'seq');
        assert.equal(direction, 'desc');
        return query;
      },
      limit: (limit: number) => {
        assert.equal(limit, 1);
        return query;
      },
      executeTakeFirst: async () => {
        if (!conversationId) {
          throw new Error('missing conversation_id message lookup filter');
        }

        messageSeqLookups.push(conversationId);
        return messages
          .filter((message) => message.conversation_id === conversationId)
          .sort((left, right) => right.seq - left.seq)[0];
      },
    };

    return query;
  }

  function createMessageInsertQuery(tableName: string) {
    assert.equal(tableName, 'messages');
    let pendingValues: MessageInsertValues | undefined;

    const query = {
      values: (values: MessageInsertValues) => {
        pendingValues = values;
        return query;
      },
      returning: () => query,
      executeTakeFirstOrThrow: async () => {
        if (!pendingValues) {
          throw new Error('missing message insert values');
        }

        messageInserts.push(pendingValues);
        const newMessage = {
          id: `message-${messages.length + 1}`,
          ...pendingValues,
        };
        messages.push(newMessage);

        return newMessage;
      },
    };

    return query;
  }

  const database = {
    insertInto: createMessageInsertQuery,
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
    messageInserts,
    messages,
  };
}

function createEnabledFakeDatabase(options: Omit<FakeDatabaseOptions, 'widget' | 'allowedDomains'> = {}): FakeDatabase {
  const fakeOptions: FakeDatabaseOptions = {
    widget: enabledDemoWidget(),
    allowedDomains: [{ domain: 'localhost', enabled: true }],
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

  return createFakeDatabase(fakeOptions);
}

test('POST /api/widgets/:publicKey/messages stores one visitor message with the next seq', async () => {
  const fake = createEnabledFakeDatabase({
    messages: [
      messageRow({ id: 'message-1', conversationId: CONVERSATION_ID_A, seq: 1, body: 'Existing' }),
    ],
  });
  const app = buildApp({ database: fake.database });

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
    assert.deepEqual(fake.messageSeqLookups, [CONVERSATION_ID_A]);
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
      ],
    );
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

test('visitor message route has no fake reply, streaming, idempotency, Gateway, or UI behavior', () => {
  assert.match(visitorMessageSource, /\/api\/widgets\/:publicKey\/messages/);
  assert.match(visitorMessageSource, /insertConversationMessage/);
  assert.match(visitorMessageSource, /clientMessageId/);
  assert.doesNotMatch(
    visitorMessageSource,
    /assistant|agent|system|onConflict|EventSource|WebSocket|Gateway|localStorage|postMessage|setTimeout|fake/i,
  );
});

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
