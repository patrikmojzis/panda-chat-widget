import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildApp } from './app.ts';
import type { DatabaseClient } from './db.ts';
import type { AllowedDomainRecord } from './origin-domain.ts';
import type { PublicWriteRateLimitInput } from './rate-limit.ts';
import { DEMO_SEED_DATA } from './seed-data.ts';
import { getOrCreateVisitorSession } from './visitor-session.ts';

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
  visitor_key: string;
  created_at: Date | string;
  last_seen_at: Date | string;
};

type VisitorSessionInsertValues = Omit<StoredVisitorSession, 'id'>;

type FakeDatabaseOptions = {
  widget?: WidgetLookupRow;
  allowedDomains?: AllowedDomainRecord[];
  visitorSessions?: StoredVisitorSession[];
};

type FakeDatabase = {
  database: DatabaseClient;
  publicKeyLookups: string[];
  allowedDomainWidgetLookups: string[];
  enabledDomainFilters: boolean[];
  visitorSessionUpserts: VisitorSessionInsertValues[];
  visitorSessions: StoredVisitorSession[];
};

const VISITOR_KEY_A = `pvk_${'A'.repeat(43)}`;
const VISITOR_KEY_B = `pvk_${'B'.repeat(43)}`;
const visitorSessionSource = await readFile(new URL('./visitor-session.ts', import.meta.url), 'utf8');


function assertNoPandaConnectionFields(value: unknown): void {
  const serialized = JSON.stringify(value);

  assert.doesNotMatch(serialized, /connection|routeHandle|panda_route_handle/);
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
  const visitorSessionUpserts: VisitorSessionInsertValues[] = [];
  const visitorSessions = [...(options.visitorSessions ?? [])];

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

  function createVisitorSessionInsertQuery(tableName: string) {
    assert.equal(tableName, 'visitor_sessions');
    let pendingValues: VisitorSessionInsertValues | undefined;
    let conflictColumns: string[] = [];
    let updateSet: Partial<Pick<StoredVisitorSession, 'last_seen_at'>> = {};

    const query = {
      values: (values: VisitorSessionInsertValues) => {
        pendingValues = values;
        return query;
      },
      onConflict: (
        buildConflict: (builder: {
          columns: (columns: string[]) => {
            doUpdateSet: (updates: Partial<Pick<StoredVisitorSession, 'last_seen_at'>>) => unknown;
          };
        }) => unknown,
      ) => {
        buildConflict({
          columns: (columns: string[]) => {
            conflictColumns = columns;
            return {
              doUpdateSet: (updates: Partial<Pick<StoredVisitorSession, 'last_seen_at'>>) => {
                updateSet = updates;
                return query;
              },
            };
          },
        });
        return query;
      },
      returning: () => query,
      executeTakeFirstOrThrow: async () => {
        if (!pendingValues) {
          throw new Error('missing visitor session insert values');
        }

        assert.deepEqual(conflictColumns, ['widget_id', 'visitor_key']);
        visitorSessionUpserts.push(pendingValues);
        const existingSession = visitorSessions.find(
          (session) =>
            session.widget_id === pendingValues?.widget_id && session.visitor_key === pendingValues?.visitor_key,
        );

        if (existingSession) {
          existingSession.last_seen_at = updateSet.last_seen_at ?? existingSession.last_seen_at;

          return { id: existingSession.id, visitor_key: existingSession.visitor_key };
        }

        const newSession = {
          id: `visitor-session-${visitorSessions.length + 1}`,
          ...pendingValues,
        };
        visitorSessions.push(newSession);

        return { id: newSession.id, visitor_key: newSession.visitor_key };
      },
    };

    return query;
  }

  const database = {
    insertInto: createVisitorSessionInsertQuery,
    selectFrom: (table: string) => {
      if (table === 'widgets') {
        return widgetQuery;
      }

      if (table === 'allowed_domains') {
        return allowedDomainsQuery;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as DatabaseClient;

  return {
    database,
    publicKeyLookups,
    allowedDomainWidgetLookups,
    enabledDomainFilters,
    visitorSessionUpserts,
    visitorSessions,
  };
}

function createEnabledFakeDatabase(): FakeDatabase {
  return createFakeDatabase({
    widget: enabledDemoWidget(),
    allowedDomains: [{ domain: 'localhost', enabled: true }],
  });
}

test('POST /api/widgets/:publicKey/visitor-session creates a visitor session for a new opaque key', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/visitor-session`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorKey: VISITOR_KEY_A },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      visitorSession: {
        id: 'visitor-session-1',
        visitorKey: VISITOR_KEY_A,
      },
    });
    assertNoPandaConnectionFields(response.json());
    assert.deepEqual(fake.publicKeyLookups, [DEMO_SEED_DATA.publicWidgetKey]);
    assert.deepEqual(fake.allowedDomainWidgetLookups, ['widget-id']);
    assert.deepEqual(fake.enabledDomainFilters, [true]);
    assert.deepEqual(
      fake.visitorSessionUpserts.map((values) => ({ widget_id: values.widget_id, visitor_key: values.visitor_key })),
      [{ widget_id: 'widget-id', visitor_key: VISITOR_KEY_A }],
    );
    assert.equal(fake.visitorSessions.length, 1);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/visitor-session returns the same session for an existing opaque key', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const firstResponse = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/visitor-session`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorKey: VISITOR_KEY_A },
    });
    const secondResponse = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/visitor-session`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorKey: VISITOR_KEY_A },
    });

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 200);
    assert.deepEqual(firstResponse.json(), secondResponse.json());
    assert.equal(fake.visitorSessions.length, 1);
    assert.equal(fake.visitorSessionUpserts.length, 2);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/visitor-session creates a different session for a different opaque key', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const firstResponse = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/visitor-session`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorKey: VISITOR_KEY_A },
    });
    const secondResponse = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/visitor-session`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorKey: VISITOR_KEY_B },
    });

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 200);
    assert.deepEqual(secondResponse.json(), {
      visitorSession: {
        id: 'visitor-session-2',
        visitorKey: VISITOR_KEY_B,
      },
    });
    assert.equal(fake.visitorSessions.length, 2);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/visitor-session rejects invalid public keys before validation writes', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/widgets/%20/visitor-session',
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorKey: VISITOR_KEY_A },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'invalid_widget_request', reason: 'missing_public_key' });
    assert.deepEqual(fake.publicKeyLookups, []);
    assert.deepEqual(fake.visitorSessionUpserts, []);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/visitor-session rate-limit hook can reject before creating sessions', async () => {
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
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/visitor-session`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorKey: VISITOR_KEY_A },
    });

    assert.equal(response.statusCode, 429);
    assert.deepEqual(response.json(), { error: 'rate_limited', reason: 'too_many_requests' });
    assert.deepEqual(rateLimitInputs, [{
      route: 'visitor_session_create',
      publicKey: DEMO_SEED_DATA.publicWidgetKey,
      visitorKey: VISITOR_KEY_A,
    }]);
    assert.deepEqual(fake.visitorSessionUpserts, []);
    assert.deepEqual(fake.visitorSessions, []);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/visitor-session rejects invalid visitor keys before widget lookup', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/visitor-session`,
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorKey: 'visitor@example.test' },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'invalid_visitor_key', reason: 'invalid_format' });
    assert.deepEqual(fake.publicKeyLookups, []);
    assert.deepEqual(fake.allowedDomainWidgetLookups, []);
    assert.deepEqual(fake.visitorSessionUpserts, []);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/visitor-session rejects disallowed origins without creating sessions', async () => {
  const fake = createEnabledFakeDatabase();
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/visitor-session`,
      headers: { origin: 'https://example.com' },
      payload: { visitorKey: VISITOR_KEY_A },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'origin_not_allowed', reason: 'domain_not_allowed' });
    assert.deepEqual(fake.allowedDomainWidgetLookups, ['widget-id']);
    assert.deepEqual(fake.enabledDomainFilters, [true]);
    assert.deepEqual(fake.visitorSessionUpserts, []);
  } finally {
    await app.close();
  }
});

test('POST /api/widgets/:publicKey/visitor-session rejects unknown widgets without creating sessions', async () => {
  const fake = createFakeDatabase({});
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/widgets/missing-widget/visitor-session',
      headers: { origin: 'http://localhost:5173' },
      payload: { visitorKey: VISITOR_KEY_A },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'widget_not_found' });
    assert.deepEqual(fake.visitorSessionUpserts, []);
  } finally {
    await app.close();
  }
});

test('getOrCreateVisitorSession upserts by widget and visitor key only', async () => {
  const fake = createFakeDatabase();
  const firstSeenAt = new Date('2026-01-01T00:00:00Z');
  const secondSeenAt = new Date('2026-01-02T00:00:00Z');

  const firstSession = await getOrCreateVisitorSession(fake.database, {
    widgetId: 'widget-id',
    visitorKey: VISITOR_KEY_A,
    now: firstSeenAt,
  });
  const secondSession = await getOrCreateVisitorSession(fake.database, {
    widgetId: 'widget-id',
    visitorKey: VISITOR_KEY_A,
    now: secondSeenAt,
  });

  assert.deepEqual(firstSession, { id: 'visitor-session-1', visitorKey: VISITOR_KEY_A });
  assert.deepEqual(secondSession, firstSession);
  assert.equal(fake.visitorSessions.length, 1);
  assert.equal(fake.visitorSessions[0]?.created_at, firstSeenAt);
  assert.equal(fake.visitorSessions[0]?.last_seen_at, secondSeenAt);
});

test('visitor session route uses the shared validator without fingerprinting or conversation side effects', () => {
  assert.match(visitorSessionSource, /parseVisitorKey/);
  assert.match(visitorSessionSource, /insertInto\('visitor_sessions'\)/);
  assert.doesNotMatch(
    visitorSessionSource,
    /user-agent|x-forwarded-for|request\.ip|navigator|fingerprint|hardwareConcurrency|document\.cookie/i,
  );
  assert.doesNotMatch(visitorSessionSource, /insertInto\('conversations'\)|insertInto\('messages'\)|EventSource|WebSocket/);
});
