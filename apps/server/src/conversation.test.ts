import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildApp } from './app.ts';
import {
  findVisitorSessionForWidget,
  getOrCreateDefaultConversation,
} from './conversation.ts';
import type { ConversationStatus, DatabaseClient } from './db.ts';
import type { AllowedDomainRecord } from './origin-domain.ts';
import type { PublicWriteRateLimitInput } from './rate-limit.ts';
import { DEMO_SEED_DATA } from './seed-data.ts';

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
  created_at: Date | string;
  updated_at: Date | string;
  closed_at?: Date | string | null;
};

type ConversationInsertValues = Omit<StoredConversation, 'id'>;

type FakeDatabaseOptions = {
  widget?: WidgetLookupRow;
  allowedDomains?: AllowedDomainRecord[];
  visitorSessions?: StoredVisitorSession[];
  conversations?: StoredConversation[];
};

type FakeDatabase = {
  database: DatabaseClient;
  publicKeyLookups: string[];
  allowedDomainWidgetLookups: string[];
  enabledDomainFilters: boolean[];
  visitorSessionLookups: Array<{ id: string; widgetId: string }>;
  conversationLookups: Array<{ widgetId: string; visitorSessionId: string; status: ConversationStatus }>;
  conversationInserts: ConversationInsertValues[];
  conversations: StoredConversation[];
};

const VISITOR_SESSION_ID_A = 'visitor-session-a';
const VISITOR_SESSION_ID_B = 'visitor-session-b';
const conversationSource = await readFile(new URL('./conversation.ts', import.meta.url), 'utf8');

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
  const conversationLookups: Array<{ widgetId: string; visitorSessionId: string; status: ConversationStatus }> = [];
  const conversationInserts: ConversationInsertValues[] = [];
  const visitorSessions = [...(options.visitorSessions ?? [])];
  const conversations = [...(options.conversations ?? [])];

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
    let widgetId: string | undefined;
    let visitorSessionId: string | undefined;
    let status: ConversationStatus | undefined;

    const query = {
      select: () => query,
      where: (column: string, _operator: string, value: string) => {
        if (column === 'widget_id') {
          widgetId = value;
        }

        if (column === 'visitor_session_id') {
          visitorSessionId = value;
        }

        if (column === 'status') {
          status = value as ConversationStatus;
        }

        return query;
      },
      orderBy: () => query,
      executeTakeFirst: async () => {
        if (!widgetId || !visitorSessionId || !status) {
          throw new Error('missing conversation lookup filters');
        }

        conversationLookups.push({ widgetId, visitorSessionId, status });
        const conversation = conversations.find(
          (row) =>
            row.widget_id === widgetId &&
            row.visitor_session_id === visitorSessionId &&
            row.status === status,
        );

        if (!conversation) {
          return undefined;
        }

        return {
          id: conversation.id,
          visitor_session_id: conversation.visitor_session_id,
          status: conversation.status,
        };
      },
    };

    return query;
  }

  function createConversationInsertQuery(tableName: string) {
    assert.equal(tableName, 'conversations');
    let pendingValues: ConversationInsertValues | undefined;

    const query = {
      values: (values: ConversationInsertValues) => {
        pendingValues = values;
        return query;
      },
      returning: () => query,
      executeTakeFirstOrThrow: async () => {
        if (!pendingValues) {
          throw new Error('missing conversation insert values');
        }

        conversationInserts.push(pendingValues);
        const newConversation = {
          id: `conversation-${conversations.length + 1}`,
          ...pendingValues,
        };
        conversations.push(newConversation);

        return {
          id: newConversation.id,
          visitor_session_id: newConversation.visitor_session_id,
          status: newConversation.status,
        };
      },
    };

    return query;
  }

  const database = {
    insertInto: createConversationInsertQuery,
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
    conversationInserts,
    conversations,
  };
}

function createEnabledFakeDatabase(options: Omit<FakeDatabaseOptions, 'widget' | 'allowedDomains'> = {}): FakeDatabase {
  const fakeOptions: FakeDatabaseOptions = {
    widget: enabledDemoWidget(),
    allowedDomains: [{ domain: 'localhost', enabled: true }],
    visitorSessions: [
      { id: VISITOR_SESSION_ID_A, widget_id: 'widget-id' },
      { id: VISITOR_SESSION_ID_B, widget_id: 'widget-id' },
      ...(options.visitorSessions ?? []),
    ],
  };

  if (options.conversations) {
    fakeOptions.conversations = options.conversations;
  }

  return createFakeDatabase(fakeOptions);
}

test('POST /api/widgets/:publicKey/conversations creates an open conversation for a visitor session', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/conversations`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorSessionId: VISITOR_SESSION_ID_A },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      conversation: {
        id: 'conversation-1',
        visitorSessionId: VISITOR_SESSION_ID_A,
        status: 'open',
      },
    });
    assert.deepEqual(fake.publicKeyLookups, [DEMO_SEED_DATA.publicWidgetKey]);
    assert.deepEqual(fake.allowedDomainWidgetLookups, ['widget-id']);
    assert.deepEqual(fake.enabledDomainFilters, [true]);
    assert.deepEqual(fake.visitorSessionLookups, [{ id: VISITOR_SESSION_ID_A, widgetId: 'widget-id' }]);
    assert.deepEqual(fake.conversationLookups, [
      { widgetId: 'widget-id', visitorSessionId: VISITOR_SESSION_ID_A, status: 'open' },
    ]);
    assert.deepEqual(
      fake.conversationInserts.map((values) => ({
        widget_id: values.widget_id,
        visitor_session_id: values.visitor_session_id,
        status: values.status,
      })),
      [{ widget_id: 'widget-id', visitor_session_id: VISITOR_SESSION_ID_A, status: 'open' }],
    );
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/conversations reuses the same open conversation across refresh', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const firstResponse = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/conversations`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorSessionId: VISITOR_SESSION_ID_A },
    });
    const secondResponse = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/conversations`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorSessionId: VISITOR_SESSION_ID_A },
    });

    const expectedConversation = {
      conversation: {
        id: 'conversation-1',
        visitorSessionId: VISITOR_SESSION_ID_A,
        status: 'open',
      },
    };

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 200);
    assert.deepEqual(firstResponse.json(), expectedConversation);
    assert.deepEqual(secondResponse.json(), expectedConversation);
    assert.deepEqual(
      fake.conversationInserts.map((values) => ({
        widget_id: values.widget_id,
        visitor_session_id: values.visitor_session_id,
        status: values.status,
      })),
      [{ widget_id: 'widget-id', visitor_session_id: VISITOR_SESSION_ID_A, status: 'open' }],
    );
    assert.equal(fake.conversations.length, 1);
    assert.deepEqual(fake.conversationLookups, [
      { widgetId: 'widget-id', visitorSessionId: VISITOR_SESSION_ID_A, status: 'open' },
      { widgetId: 'widget-id', visitorSessionId: VISITOR_SESSION_ID_A, status: 'open' },
    ]);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/conversations reuses an existing open conversation for the visitor session', async () => {
  const fake = createEnabledFakeDatabase({
    conversations: [
      {
        id: 'existing-conversation',
        widget_id: 'widget-id',
        visitor_session_id: VISITOR_SESSION_ID_A,
        status: 'open',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        closed_at: null,
      },
    ],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/conversations`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorSessionId: VISITOR_SESSION_ID_A },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      conversation: {
        id: 'existing-conversation',
        visitorSessionId: VISITOR_SESSION_ID_A,
        status: 'open',
      },
    });
    assert.deepEqual(fake.conversationInserts, []);
    assert.equal(fake.conversations.length, 1);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/conversations keeps different visitor sessions independent', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const firstResponse = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/conversations`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorSessionId: VISITOR_SESSION_ID_A },
    });
    const secondResponse = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/conversations`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorSessionId: VISITOR_SESSION_ID_B },
    });

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 200);
    assert.deepEqual(firstResponse.json(), {
      conversation: {
        id: 'conversation-1',
        visitorSessionId: VISITOR_SESSION_ID_A,
        status: 'open',
      },
    });
    assert.deepEqual(secondResponse.json(), {
      conversation: {
        id: 'conversation-2',
        visitorSessionId: VISITOR_SESSION_ID_B,
        status: 'open',
      },
    });
    assert.equal(fake.conversations.length, 2);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/conversations rejects invalid public keys before validation writes', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/widgets/%20/conversations',
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorSessionId: VISITOR_SESSION_ID_A },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'invalid_widget_request', reason: 'missing_public_key' });
    assert.deepEqual(fake.publicKeyLookups, []);
    assert.deepEqual(fake.visitorSessionLookups, []);
    assert.deepEqual(fake.conversationInserts, []);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/conversations rate-limit hook can reject before creating conversations', async () => {
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
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/conversations`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorSessionId: VISITOR_SESSION_ID_A },
    });

    assert.equal(response.statusCode, 429);
    assert.deepEqual(response.json(), { error: 'rate_limited', reason: 'too_many_requests' });
    assert.deepEqual(rateLimitInputs, [{
      route: 'conversation_create',
      publicKey: DEMO_SEED_DATA.publicWidgetKey,
      visitorSessionId: VISITOR_SESSION_ID_A,
    }]);
    assert.deepEqual(fake.conversationInserts, []);
    assert.deepEqual(fake.conversations, []);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/conversations rejects invalid visitor session references before widget lookup', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/conversations`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorSessionId: '   ' },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: 'invalid_visitor_session',
      reason: 'missing_visitor_session_id',
    });
    assert.deepEqual(fake.publicKeyLookups, []);
    assert.deepEqual(fake.visitorSessionLookups, []);
    assert.deepEqual(fake.conversationInserts, []);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/conversations rejects visitor sessions outside the widget', async () => {
  const fake = createEnabledFakeDatabase({
    visitorSessions: [{ id: 'other-widget-session', widget_id: 'other-widget-id' }],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/conversations`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorSessionId: 'other-widget-session' },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'visitor_session_not_found' });
    assert.deepEqual(fake.visitorSessionLookups, [{ id: 'other-widget-session', widgetId: 'widget-id' }]);
    assert.deepEqual(fake.conversationInserts, []);
  } finally {
    await app.close();
  }
});

test('conversation service creates a new open conversation when only closed conversations exist', async () => {
  const fake = createFakeDatabase({
    conversations: [
      {
        id: 'closed-conversation',
        widget_id: 'widget-id',
        visitor_session_id: VISITOR_SESSION_ID_A,
        status: 'closed',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        closed_at: '2026-01-02T00:00:00Z',
      },
    ],
  });
  const now = new Date('2026-01-03T00:00:00Z');

  const conversation = await getOrCreateDefaultConversation(fake.database, {
    widgetId: 'widget-id',
    visitorSessionId: VISITOR_SESSION_ID_A,
    now,
  });

  assert.deepEqual(conversation, {
    id: 'conversation-2',
    visitorSessionId: VISITOR_SESSION_ID_A,
    status: 'open',
  });
  assert.deepEqual(fake.conversationInserts, [
    {
      widget_id: 'widget-id',
      visitor_session_id: VISITOR_SESSION_ID_A,
      status: 'open',
      created_at: now,
      updated_at: now,
    },
  ]);
});

test('visitor session lookup is scoped to the widget id', async () => {
  const fake = createFakeDatabase({
    visitorSessions: [{ id: VISITOR_SESSION_ID_A, widget_id: 'widget-id' }],
  });

  assert.deepEqual(await findVisitorSessionForWidget(fake.database, {
    widgetId: 'widget-id',
    visitorSessionId: VISITOR_SESSION_ID_A,
  }), { visitorSessionId: VISITOR_SESSION_ID_A });
  assert.equal(await findVisitorSessionForWidget(fake.database, {
    widgetId: 'other-widget-id',
    visitorSessionId: VISITOR_SESSION_ID_A,
  }), null);
});

test('conversation route has no message, sequence, streaming, visitor-key parsing, or UI storage behavior', () => {
  assert.match(conversationSource, /visitorSessionId/);
  assert.match(conversationSource, /selectFrom\('conversations'\)/);
  assert.match(conversationSource, /insertInto\('conversations'\)/);
  assert.doesNotMatch(
    conversationSource,
    /insertInto\('messages'\)|seq|client_message_id|parseVisitorKey|localStorage|EventSource|WebSocket|Gateway/i,
  );
});
