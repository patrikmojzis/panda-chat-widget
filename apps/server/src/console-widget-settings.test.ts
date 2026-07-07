import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from './app.ts';
import { hashSessionToken } from './auth-session.ts';
import type { DatabaseClient } from './db.ts';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const EXPIRES_AT = new Date('2030-02-01T00:00:00.000Z');
const TOKEN_A = 'A'.repeat(43);
const TOKEN_B = 'B'.repeat(43);
const USER_A = '10000000-0000-4000-8000-000000000001';
const USER_B = '10000000-0000-4000-8000-000000000002';
const WORKSPACE_A = '20000000-0000-4000-8000-000000000001';
const WORKSPACE_B = '20000000-0000-4000-8000-000000000002';
const SITE_A = '30000000-0000-4000-8000-000000000001';
const SITE_A2 = '30000000-0000-4000-8000-000000000003';
const SITE_B = '30000000-0000-4000-8000-000000000002';
const WIDGET_A = '40000000-0000-4000-8000-000000000001';
const WIDGET_A2 = '40000000-0000-4000-8000-000000000003';
const WIDGET_B = '40000000-0000-4000-8000-000000000002';
const DOMAIN_A = '50000000-0000-4000-8000-000000000001';
const DOMAIN_A2 = '50000000-0000-4000-8000-000000000003';
const DOMAIN_B = '50000000-0000-4000-8000-000000000002';

type StoredUser = {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type StoredWorkspace = {
  id: string;
  owner_user_id: string;
  name: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type StoredAuthSession = {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date | string;
  last_seen_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
};

type StoredSite = {
  id: string;
  workspace_id: string | null;
  name: string;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type StoredWidget = {
  id: string;
  site_id: string;
  public_key: string;
  panda_route_handle: string | null;
  name: string;
  assistant_display_name: string;
  launcher_label: string;
  launcher_icon: string;
  welcome_title: string;
  welcome_subtitle: string;
  theme_color_mode: string;
  theme_accent: string;
  theme_radius: string;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type StoredDomain = {
  id: string;
  widget_id: string;
  domain: string;
  enabled: boolean;
  created_at: Date | string;
};

type StoredPandaDeliveryIntent = {
  id: string;
  widget_id: string;
  status: string;
  claimed_at: Date | string | null;
  created_at: Date | string;
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
  joins: string[];
  wheres: WhereClause[];
  orders: OrderClause[];
  mode: 'execute' | 'executeTakeFirst';
};

type UpdateLog = {
  table: string;
  updates: Record<string, unknown>;
  wheres: WhereClause[];
};

type InsertLog = {
  table: string;
  values: Record<string, unknown>;
};

type DeleteLog = {
  table: string;
  wheres: WhereClause[];
};

type FakeConsoleWidgetSettingsDatabase = {
  database: DatabaseClient;
  users: StoredUser[];
  workspaces: StoredWorkspace[];
  authSessions: StoredAuthSession[];
  sites: StoredSite[];
  widgets: StoredWidget[];
  domains: StoredDomain[];
  deliveryIntents: StoredPandaDeliveryIntent[];
  selects: SelectLog[];
  updates: UpdateLog[];
  inserts: InsertLog[];
  deletes: DeleteLog[];
};

function createFakeConsoleWidgetSettingsDatabase(): FakeConsoleWidgetSettingsDatabase {
  const fake: FakeConsoleWidgetSettingsDatabase = {
    database: {} as DatabaseClient,
    users: [
      {
        id: USER_A,
        email: 'owner-a@example.test',
        password_hash: 'hash-a',
        created_at: NOW,
        updated_at: NOW,
      },
      {
        id: USER_B,
        email: 'owner-b@example.test',
        password_hash: 'hash-b',
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    workspaces: [
      {
        id: WORKSPACE_A,
        owner_user_id: USER_A,
        name: 'Workspace A',
        created_at: NOW,
        updated_at: NOW,
      },
      {
        id: WORKSPACE_B,
        owner_user_id: USER_B,
        name: 'Workspace B',
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    authSessions: [
      {
        id: 'session-a',
        user_id: USER_A,
        token_hash: hashSessionToken(TOKEN_A),
        created_at: NOW,
        last_seen_at: NOW,
        expires_at: EXPIRES_AT,
        revoked_at: null,
      },
      {
        id: 'session-b',
        user_id: USER_B,
        token_hash: hashSessionToken(TOKEN_B),
        created_at: NOW,
        last_seen_at: NOW,
        expires_at: EXPIRES_AT,
        revoked_at: null,
      },
    ],
    sites: [
      siteRow(SITE_A, WORKSPACE_A, 'Alpha Site'),
      siteRow(SITE_A2, WORKSPACE_A, 'Alpha Other Site'),
      siteRow(SITE_B, WORKSPACE_B, 'Beta Site'),
    ],
    widgets: [
      widgetRow(WIDGET_A, SITE_A, 'alpha-widget', 'Alpha Widget'),
      widgetRow(WIDGET_A2, SITE_A2, 'alpha-widget-2', 'Alpha Widget 2'),
      widgetRow(WIDGET_B, SITE_B, 'beta-widget', 'Beta Widget'),
    ],
    domains: [
      domainRow(DOMAIN_A, WIDGET_A, 'alpha.example'),
      domainRow(DOMAIN_A2, WIDGET_A2, 'alpha2.example'),
      domainRow(DOMAIN_B, WIDGET_B, 'beta.example'),
    ],
    deliveryIntents: [],
    selects: [],
    updates: [],
    inserts: [],
    deletes: [],
  };

  fake.database = {
    selectFrom: (table: string) => createSelectQuery(fake, table),
    updateTable: (table: string) => createUpdateQuery(fake, table),
    insertInto: (table: string) => createInsertQuery(fake, table),
    deleteFrom: (table: string) => createDeleteQuery(fake, table),
  } as unknown as DatabaseClient;

  return fake;
}

function siteRow(id: string, workspaceId: string, name: string): StoredSite {
  return {
    id,
    workspace_id: workspaceId,
    name,
    enabled: true,
    created_at: NOW,
    updated_at: NOW,
  };
}

function widgetRow(id: string, siteId: string, publicKey: string, name: string): StoredWidget {
  return {
    id,
    site_id: siteId,
    public_key: publicKey,
    panda_route_handle: null,
    name,
    assistant_display_name: 'Support',
    launcher_label: 'Chat',
    launcher_icon: 'message',
    welcome_title: 'Hi there',
    welcome_subtitle: 'Send us a message and we will reply as soon as we can.',
    theme_color_mode: 'system',
    theme_accent: 'blue',
    theme_radius: 'md',
    enabled: true,
    created_at: NOW,
    updated_at: NOW,
  };
}

function domainRow(id: string, widgetId: string, domain: string): StoredDomain {
  return {
    id,
    widget_id: widgetId,
    domain,
    enabled: true,
    created_at: NOW,
  };
}

function deliveryIntentRow(
  id: string,
  widgetId: string,
  status: string,
  createdAt: Date | string,
  claimedAt: Date | string | null = null,
): StoredPandaDeliveryIntent {
  return {
    id,
    widget_id: widgetId,
    status,
    claimed_at: claimedAt,
    created_at: createdAt,
  };
}

function createConsoleApp(fake: FakeConsoleWidgetSettingsDatabase) {
  return buildApp({
    database: fake.database,
    auth: {
      now: () => NOW,
    },
  });
}

function createSelectQuery(fake: FakeConsoleWidgetSettingsDatabase, table: string) {
  const joins: string[] = [];
  const wheres: WhereClause[] = [];
  const orders: OrderClause[] = [];
  let limitCount: number | undefined;

  const query = {
    innerJoin: (joinedTable: string) => {
      joins.push(joinedTable);
      return query;
    },
    select: () => query,
    where: (column: string, operator: string, value: unknown) => {
      wheres.push({ column, operator, value });
      return query;
    },
    orderBy: (column: string, direction: string) => {
      orders.push({ column, direction });
      return query;
    },
    limit: (count: number) => {
      limitCount = count;
      return query;
    },
    execute: async () => {
      fake.selects.push(cloneSelectLog(table, joins, wheres, orders, 'execute'));
      return selectRows(fake, table, wheres, orders, limitCount);
    },
    executeTakeFirst: async () => {
      fake.selects.push(cloneSelectLog(table, joins, wheres, orders, 'executeTakeFirst'));
      return selectRows(fake, table, wheres, orders, limitCount)[0];
    },
  };

  return query;
}

function createUpdateQuery(fake: FakeConsoleWidgetSettingsDatabase, table: string) {
  let updates: Record<string, unknown> = {};
  const wheres: WhereClause[] = [];

  const query = {
    set: (values: Record<string, unknown>) => {
      updates = { ...values };
      return query;
    },
    where: (column: string, operator: string, value: unknown) => {
      wheres.push({ column, operator, value });
      return query;
    },
    execute: async () => {
      fake.updates.push({ table, updates: { ...updates }, wheres: wheres.map((where) => ({ ...where })) });

      if (table === 'auth_sessions') {
        for (const session of fake.authSessions) {
          if (matchesWhereClauses(session, wheres)) {
            Object.assign(session, updates);
          }
        }

        return;
      }

      if (table === 'widgets') {
        for (const widget of fake.widgets) {
          if (matchesWhereClauses(widget, wheres)) {
            Object.assign(widget, updates);
          }
        }

        return;
      }

      throw new Error(`Unexpected update table: ${table}`);
    },
  };

  return query;
}

function createInsertQuery(fake: FakeConsoleWidgetSettingsDatabase, table: string) {
  let pendingValues: Record<string, unknown> | undefined;

  const query = {
    values: (values: Record<string, unknown>) => {
      pendingValues = { ...values };
      return query;
    },
    onConflict: (handler: (builder: unknown) => unknown) => {
      handler({ columns: () => ({ doUpdateSet: () => undefined }) });
      return query;
    },
    returning: () => query,
    executeTakeFirstOrThrow: async () => {
      if (table !== 'allowed_domains' || !pendingValues) {
        throw new Error(`Unexpected insert table: ${table}`);
      }

      fake.inserts.push({ table, values: { ...pendingValues } });
      const widgetId = String(pendingValues.widget_id);
      const domain = String(pendingValues.domain);
      let row = fake.domains.find((candidate) => candidate.widget_id === widgetId && candidate.domain === domain);

      if (row) {
        row.enabled = true;
      } else {
        row = {
          id: generatedDomainUuid(fake.domains.length + 1),
          widget_id: widgetId,
          domain,
          enabled: true,
          created_at: dateValue(pendingValues.created_at),
        };
        fake.domains.push(row);
      }

      return row;
    },
  };

  return query;
}

function createDeleteQuery(fake: FakeConsoleWidgetSettingsDatabase, table: string) {
  const wheres: WhereClause[] = [];

  const query = {
    where: (column: string, operator: string, value: unknown) => {
      wheres.push({ column, operator, value });
      return query;
    },
    returning: () => query,
    executeTakeFirst: async () => {
      if (table !== 'allowed_domains') {
        throw new Error(`Unexpected delete table: ${table}`);
      }

      fake.deletes.push({ table, wheres: wheres.map((where) => ({ ...where })) });
      const index = fake.domains.findIndex((domain) => matchesWhereClauses(domain, wheres));

      if (index < 0) {
        return undefined;
      }

      const [deleted] = fake.domains.splice(index, 1);

      return deleted ? { id: deleted.id } : undefined;
    },
  };

  return query;
}

function selectRows(
  fake: FakeConsoleWidgetSettingsDatabase,
  table: string,
  wheres: WhereClause[],
  orders: OrderClause[],
  limitCount: number | undefined,
): unknown[] {
  let rows: unknown[];

  if (table === 'auth_sessions') {
    const authRow = selectAuthSessionRow(fake, wheres);
    rows = authRow ? [authRow] : [];
  } else if (table === 'widgets') {
    rows = selectOwnedWidgets(fake, wheres);
  } else if (table === 'allowed_domains') {
    rows = sortRows(fake.domains.filter((domain) => matchesWhereClauses(domain, wheres)), orders);
  } else if (table === 'panda_delivery_intents') {
    rows = [selectLocalDeliveryStatusRow(fake, wheres)];
  } else {
    throw new Error(`Unexpected select table: ${table}`);
  }

  return typeof limitCount === 'number' ? rows.slice(0, limitCount) : rows;
}

function selectOwnedWidgets(fake: FakeConsoleWidgetSettingsDatabase, wheres: WhereClause[]): StoredWidget[] {
  return fake.widgets.filter((widget) => {
    const site = fake.sites.find((candidate) => candidate.id === widget.site_id);

    if (!site) {
      return false;
    }

    return wheres.every((where) => {
      if (where.column === 'sites.id') {
        return site.id === where.value;
      }

      if (where.column === 'sites.workspace_id') {
        return site.workspace_id === where.value;
      }

      if (where.column === 'widgets.site_id') {
        return widget.site_id === where.value;
      }

      if (where.column === 'widgets.id') {
        return widget.id === where.value;
      }

      return matchesWhereClause(widget, where);
    });
  });
}

function selectLocalDeliveryStatusRow(
  fake: FakeConsoleWidgetSettingsDatabase,
  wheres: WhereClause[],
): { queued_intent_count: string; last_queued_at: Date | string | null } {
  const intents = fake.deliveryIntents.filter((intent) => matchesWhereClauses(intent, wheres));
  let lastQueuedAt: Date | string | null = null;

  for (const intent of intents) {
    if (lastQueuedAt === null || comparableValue(intent.created_at) > comparableValue(lastQueuedAt)) {
      lastQueuedAt = intent.created_at;
    }
  }

  return { queued_intent_count: String(intents.length), last_queued_at: lastQueuedAt };
}

function selectAuthSessionRow(fake: FakeConsoleWidgetSettingsDatabase, wheres: WhereClause[]): unknown | undefined {
  const tokenHash = whereValue(wheres, 'auth_sessions.token_hash');
  const now = whereValue(wheres, 'auth_sessions.expires_at');
  const session = fake.authSessions.find((candidate) => {
    if (typeof tokenHash === 'string' && candidate.token_hash !== tokenHash) {
      return false;
    }

    if (candidate.revoked_at !== null) {
      return false;
    }

    if (now instanceof Date && !(new Date(candidate.expires_at) > now)) {
      return false;
    }

    return true;
  });
  const user = session ? fake.users.find((candidate) => candidate.id === session.user_id) : undefined;
  const workspace = user
    ? fake.workspaces.find((candidate) => candidate.owner_user_id === user.id)
    : undefined;

  if (!session || !user || !workspace) {
    return undefined;
  }

  return {
    sessionId: session.id,
    userId: user.id,
    email: user.email,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
  };
}

function cloneSelectLog(
  table: string,
  joins: string[],
  wheres: WhereClause[],
  orders: OrderClause[],
  mode: SelectLog['mode'],
): SelectLog {
  return {
    table,
    joins: [...joins],
    wheres: wheres.map((where) => ({ ...where })),
    orders: orders.map((order) => ({ ...order })),
    mode,
  };
}

function matchesWhereClauses(row: Record<string, unknown>, wheres: WhereClause[]): boolean {
  return wheres.every((where) => matchesWhereClause(row, where));
}

function matchesWhereClause(row: Record<string, unknown>, where: WhereClause): boolean {
  const value = row[unqualifiedColumn(where.column)];

  if (where.operator === '=') {
    return value === where.value;
  }

  if (where.operator === 'is') {
    return value === where.value;
  }

  if (where.operator === '>' && where.value instanceof Date) {
    return new Date(String(value)) > where.value;
  }

  throw new Error(`Unsupported where operator ${where.operator}`);
}

function sortRows<T extends Record<string, unknown>>(rows: T[], orders: OrderClause[]): T[] {
  return [...rows].sort((left, right) => {
    for (const order of orders) {
      const column = unqualifiedColumn(order.column);
      const leftValue = comparableValue(left[column]);
      const rightValue = comparableValue(right[column]);

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

function whereValue(wheres: WhereClause[], column: string): unknown {
  return wheres.find((where) => where.column === column)?.value;
}

function unqualifiedColumn(column: string): string {
  return column.includes('.') ? column.slice(column.lastIndexOf('.') + 1) : column;
}

function dateValue(value: unknown): Date | string {
  return value instanceof Date || typeof value === 'string' ? value : NOW;
}

function generatedDomainUuid(index: number): string {
  return `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function sessionCookie(token: string): string {
  return `pcw_session=${token}`;
}

function csrfHeaders(token: string): Record<string, string> {
  return {
    cookie: sessionCookie(token),
    'x-panda-csrf': '1',
  };
}

function widgetUpdateLogs(fake: FakeConsoleWidgetSettingsDatabase): UpdateLog[] {
  return fake.updates.filter((update) => update.table === 'widgets');
}

function assertNoWidgetDomainWrites(fake: FakeConsoleWidgetSettingsDatabase): void {
  assert.equal(widgetUpdateLogs(fake).length, 0);
  assert.equal(fake.inserts.length, 0);
  assert.equal(fake.deletes.length, 0);
}

function hasWhere(log: SelectLog, column: string, value: unknown): boolean {
  return log.wheres.some((where) => where.column === column && where.operator === '=' && where.value === value);
}

function assertLocalDeliveryQuery(fake: FakeConsoleWidgetSettingsDatabase, widgetId: string): void {
  assert.equal(
    fake.selects.some((log) =>
      log.table === 'panda_delivery_intents' && hasWhere(log, 'widget_id', widgetId) && hasWhere(log, 'status', 'queued'),
    ),
    true,
    `expected queued local delivery status query for widget ${widgetId}`,
  );
}

function assertOwnedWidgetQuery(fake: FakeConsoleWidgetSettingsDatabase, workspaceId: string, siteId: string, widgetId: string): void {
  assert.equal(
    fake.selects.some((log) =>
      log.table === 'widgets' &&
      hasWhere(log, 'sites.workspace_id', workspaceId) &&
      hasWhere(log, 'sites.id', siteId) &&
      hasWhere(log, 'widgets.site_id', siteId) &&
      hasWhere(log, 'widgets.id', widgetId),
    ),
    true,
    `expected owned widget query for workspace ${workspaceId}, site ${siteId}, widget ${widgetId}`,
  );
}

test('console widget settings/domain APIs return JSON 401 without a session', async () => {
  const fake = createFakeConsoleWidgetSettingsDatabase();
  const app = createConsoleApp(fake);

  try {
    for (const route of [
      { method: 'GET', url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/settings` },
      { method: 'PATCH', url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/settings`, payload: { name: 'No session' } },
      { method: 'GET', url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/domains` },
      { method: 'POST', url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/domains`, payload: { domain: 'example.com' } },
      { method: 'DELETE', url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/domains/${DOMAIN_A}` },
    ] as const) {
      const response = await app.inject(route);

      assert.equal(response.statusCode, 401);
      assert.match(response.headers['content-type'] ?? '', /^application\/json/);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual(response.json(), { error: 'unauthenticated' });
    }

    assertNoWidgetDomainWrites(fake);
  } finally {
    await app.close();
  }
});

test('console widget settings/domain writes reject missing CSRF before DB writes', async () => {
  const fake = createFakeConsoleWidgetSettingsDatabase();
  const app = createConsoleApp(fake);

  try {
    for (const route of [
      { method: 'PATCH', url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/settings`, payload: { name: 'CSRF' } },
      { method: 'POST', url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/domains`, payload: { domain: 'example.com' } },
      { method: 'DELETE', url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/domains/${DOMAIN_A}` },
    ] as const) {
      const response = await app.inject({
        ...route,
        headers: { cookie: sessionCookie(TOKEN_A) },
      });

      assert.equal(response.statusCode, 403);
      assert.deepEqual(response.json(), { error: 'csrf_protection_failed', reason: 'missing_csrf_protection' });
      assert.equal(response.headers['cache-control'], 'no-store');
    }

    assertNoWidgetDomainWrites(fake);
    assert.equal(fake.domains.some((domain) => domain.id === DOMAIN_A), true);
  } finally {
    await app.close();
  }
});

test('console widget settings/domains are scoped through owning workspace, site, and widget', async () => {
  const fake = createFakeConsoleWidgetSettingsDatabase();
  const app = createConsoleApp(fake);

  try {
    const crossWorkspaceRead = await app.inject({
      method: 'GET',
      url: `/api/console/sites/${SITE_B}/widgets/${WIDGET_B}/settings`,
      headers: { cookie: sessionCookie(TOKEN_A) },
    });
    assert.equal(crossWorkspaceRead.statusCode, 404);
    assert.deepEqual(crossWorkspaceRead.json(), { error: 'widget_not_found' });
    assertOwnedWidgetQuery(fake, WORKSPACE_A, SITE_B, WIDGET_B);

    const crossWorkspacePatch = await app.inject({
      method: 'PATCH',
      url: `/api/console/sites/${SITE_B}/widgets/${WIDGET_B}/settings`,
      headers: csrfHeaders(TOKEN_A),
      payload: { connection: { routeHandle: 'panda:wrong-workspace' } },
    });
    assert.equal(crossWorkspacePatch.statusCode, 404);
    assert.deepEqual(crossWorkspacePatch.json(), { error: 'widget_not_found' });
    assertOwnedWidgetQuery(fake, WORKSPACE_A, SITE_B, WIDGET_B);

    const wrongSiteCreate = await app.inject({
      method: 'POST',
      url: `/api/console/sites/${SITE_A2}/widgets/${WIDGET_A}/domains`,
      headers: csrfHeaders(TOKEN_A),
      payload: { domain: 'wrong-site.example' },
    });
    assert.equal(wrongSiteCreate.statusCode, 404);
    assert.deepEqual(wrongSiteCreate.json(), { error: 'widget_not_found' });
    assertOwnedWidgetQuery(fake, WORKSPACE_A, SITE_A2, WIDGET_A);

    const wrongSitePatch = await app.inject({
      method: 'PATCH',
      url: `/api/console/sites/${SITE_A2}/widgets/${WIDGET_A}/settings`,
      headers: csrfHeaders(TOKEN_A),
      payload: { connection: { routeHandle: 'panda:wrong-site' } },
    });
    assert.equal(wrongSitePatch.statusCode, 404);
    assert.deepEqual(wrongSitePatch.json(), { error: 'widget_not_found' });
    assertOwnedWidgetQuery(fake, WORKSPACE_A, SITE_A2, WIDGET_A);

    const wrongWidgetPatch = await app.inject({
      method: 'PATCH',
      url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A2}/settings`,
      headers: csrfHeaders(TOKEN_A),
      payload: { connection: { routeHandle: 'panda:wrong-widget' } },
    });
    assert.equal(wrongWidgetPatch.statusCode, 404);
    assert.deepEqual(wrongWidgetPatch.json(), { error: 'widget_not_found' });
    assertOwnedWidgetQuery(fake, WORKSPACE_A, SITE_A, WIDGET_A2);

    const otherWidgetDomainDelete = await app.inject({
      method: 'DELETE',
      url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/domains/${DOMAIN_A2}`,
      headers: csrfHeaders(TOKEN_A),
    });
    assert.equal(otherWidgetDomainDelete.statusCode, 404);
    assert.deepEqual(otherWidgetDomainDelete.json(), { error: 'domain_not_found' });
    assertOwnedWidgetQuery(fake, WORKSPACE_A, SITE_A, WIDGET_A);

    assert.equal(widgetUpdateLogs(fake).length, 0);
    assert.equal(fake.inserts.length, 0);
    assert.equal(fake.domains.some((domain) => domain.id === DOMAIN_A2), true);
  } finally {
    await app.close();
  }
});

test('console domain create validates and normalizes domains before writes', async () => {
  const fake = createFakeConsoleWidgetSettingsDatabase();
  const app = createConsoleApp(fake);

  try {
    const invalidValues = ['', 'localhost:5173', 'ftp://example.com', 'https://example.com/path', '*.example.com', '<script>'];

    for (const value of invalidValues) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/domains`,
        headers: csrfHeaders(TOKEN_A),
        payload: { domain: value },
      });

      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error, 'invalid_domain_request');
    }

    assert.equal(fake.inserts.length, 0);

    const created = await app.inject({
      method: 'POST',
      url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/domains`,
      headers: csrfHeaders(TOKEN_A),
      payload: { domain: ' https://Example.COM:443 ' },
    });

    assert.equal(created.statusCode, 201);
    assert.equal(created.json().domain.domain, 'example.com');
    assert.equal(fake.inserts.at(-1)?.values.domain, 'example.com');
    assertOwnedWidgetQuery(fake, WORKSPACE_A, SITE_A, WIDGET_A);
  } finally {
    await app.close();
  }
});

test('console widget settings PATCH accepts only safe fields and updates timestamps server-side', async () => {
  const fake = createFakeConsoleWidgetSettingsDatabase();
  const app = createConsoleApp(fake);

  try {
    for (const payload of [
      { publicKey: 'client-key' },
      { enabled: false },
      { updatedAt: 'client-time' },
      { config: { theme: { customCss: 'body{}' } } },
      { config: { welcome: { html: '<strong>Hi</strong>' } } },
      { config: { theme: { colorMode: 'sepia' } } },
      { config: { assistant: { displayName: '<b>Bad</b>' } } },
      { connection: { status: 'configured_placeholder' } },
      { connection: { localDelivery: { queuedIntentCount: 99, lastQueuedAt: NOW.toISOString() } } },
      { connection: { queuedIntentCount: 99 } },
      { connection: { lastQueuedAt: NOW.toISOString() } },
      { connection: { routeHandle: '   ' } },
      { connection: { routeHandle: '<script>' } },
      { connection: { routeHandle: 'x'.repeat(201) } },
      { connection: { routeHandle: 123 } },
      { name: '   ' },
      {},
    ]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/settings`,
        headers: csrfHeaders(TOKEN_A),
        payload,
      });

      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error, 'invalid_widget_settings_request');
    }

    assert.equal(widgetUpdateLogs(fake).length, 0);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/settings`,
      headers: csrfHeaders(TOKEN_A),
      payload: {
        name: '  Updated Widget  ',
        config: {
          assistant: { displayName: '  Help Desk  ' },
          launcher: { label: '  Talk to us  ', icon: 'message' },
          welcome: { title: '  Welcome  ', subtitle: '  We are here.  ' },
          theme: { colorMode: 'dark', accent: 'blue', radius: 'md' },
        },
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().widget.name, 'Updated Widget');
    assert.equal(response.json().config.assistant.displayName, 'Help Desk');
    assert.equal(response.json().config.theme.colorMode, 'dark');

    const update = widgetUpdateLogs(fake).at(-1);
    assert.ok(update);
    assert.equal(update.updates.name, 'Updated Widget');
    assert.equal(update.updates.assistant_display_name, 'Help Desk');
    assert.equal(update.updates.updated_at instanceof Date, true);
    assert.equal('publicKey' in update.updates, false);
    assert.equal('public_key' in update.updates, false);
    assert.equal('enabled' in update.updates, false);
    assertOwnedWidgetQuery(fake, WORKSPACE_A, SITE_A, WIDGET_A);
  } finally {
    await app.close();
  }
});


test('console widget settings GET and PATCH manage the Panda connection placeholder with no-store responses', async () => {
  const fake = createFakeConsoleWidgetSettingsDatabase();
  const app = createConsoleApp(fake);

  try {
    const initial = await app.inject({
      method: 'GET',
      url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/settings`,
      headers: { cookie: sessionCookie(TOKEN_A) },
    });

    assert.equal(initial.statusCode, 200);
    assert.equal(initial.headers['cache-control'], 'no-store');
    assert.deepEqual(initial.json().connection, {
      status: 'not_configured',
      routeHandle: null,
      localDelivery: { queuedIntentCount: 0, lastQueuedAt: null },
    });

    const configured = await app.inject({
      method: 'PATCH',
      url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/settings`,
      headers: csrfHeaders(TOKEN_A),
      payload: { connection: { routeHandle: '  panda:workspace/alpha  ' } },
    });

    assert.equal(configured.statusCode, 200);
    assert.equal(configured.headers['cache-control'], 'no-store');
    assert.deepEqual(configured.json().connection, {
      status: 'configured_placeholder',
      routeHandle: 'panda:workspace/alpha',
      localDelivery: { queuedIntentCount: 0, lastQueuedAt: null },
    });

    const configureUpdate = widgetUpdateLogs(fake).at(-1);
    assert.ok(configureUpdate);
    assert.equal(configureUpdate.updates.panda_route_handle, 'panda:workspace/alpha');
    assert.equal(configureUpdate.updates.updated_at instanceof Date, true);
    assert.equal('status' in configureUpdate.updates, false);
    assertOwnedWidgetQuery(fake, WORKSPACE_A, SITE_A, WIDGET_A);

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/settings`,
      headers: csrfHeaders(TOKEN_A),
      payload: { connection: { routeHandle: null } },
    });

    assert.equal(cleared.statusCode, 200);
    assert.equal(cleared.headers['cache-control'], 'no-store');
    assert.deepEqual(cleared.json().connection, {
      status: 'not_configured',
      routeHandle: null,
      localDelivery: { queuedIntentCount: 0, lastQueuedAt: null },
    });

    const clearUpdate = widgetUpdateLogs(fake).at(-1);
    assert.ok(clearUpdate);
    assert.equal(clearUpdate.updates.panda_route_handle, null);
    assert.equal(clearUpdate.updates.updated_at instanceof Date, true);
  } finally {
    await app.close();
  }
});

test('console widget settings GET exposes queued local delivery status for the owned widget only', async () => {
  const fake = createFakeConsoleWidgetSettingsDatabase();
  fake.deliveryIntents = [
    deliveryIntentRow('intent-a-1', WIDGET_A, 'queued', '2026-01-01T00:01:00.000Z'),
    deliveryIntentRow('intent-a-2', WIDGET_A, 'queued', new Date('2026-01-01T00:03:00.000Z')),
    deliveryIntentRow(
      'intent-a-claimed-newer',
      WIDGET_A,
      'claimed',
      '2026-01-01T00:04:00.000Z',
      '2026-01-01T00:04:30.000Z',
    ),
    deliveryIntentRow('intent-a2', WIDGET_A2, 'queued', '2026-01-01T00:05:00.000Z'),
    deliveryIntentRow('intent-b', WIDGET_B, 'queued', '2026-01-01T00:06:00.000Z'),
  ];
  const app = createConsoleApp(fake);

  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/settings`,
      headers: { cookie: sessionCookie(TOKEN_A) },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().connection.localDelivery, {
      queuedIntentCount: 2,
      lastQueuedAt: '2026-01-01T00:03:00.000Z',
    });
    assertLocalDeliveryQuery(fake, WIDGET_A);
  } finally {
    await app.close();
  }
});

test('console widget settings exposes gated, escaped public-key-only install snippets', async () => {
  const fake = createFakeConsoleWidgetSettingsDatabase();
  fake.domains = [];
  const app = createConsoleApp(fake);

  try {
    const withoutDomain = await app.inject({
      method: 'GET',
      url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/settings`,
      headers: { cookie: sessionCookie(TOKEN_A) },
    });

    assert.equal(withoutDomain.statusCode, 200);
    assert.equal(withoutDomain.headers['cache-control'], 'no-store');
    assert.deepEqual(withoutDomain.json().install, { snippetAvailable: false, snippet: null });

    fake.widgets.find((widget) => widget.id === WIDGET_A)!.public_key = 'bad" onload="alert(1)<script>';
    fake.domains.push(domainRow(DOMAIN_A, WIDGET_A, 'alpha.example'));

    const withDomain = await app.inject({
      method: 'GET',
      url: `/api/console/sites/${SITE_A}/widgets/${WIDGET_A}/settings`,
      headers: { cookie: sessionCookie(TOKEN_A) },
    });

    assert.equal(withDomain.statusCode, 200);
    const snippet = withDomain.json().install.snippet;

    assert.equal(withDomain.json().install.snippetAvailable, true);
    assert.match(snippet, /^<script src="\/vendor\/panda-chat-widget-loader\.js" data-public-key="/);
    assert.match(snippet, /bad&quot; onload=&quot;alert\(1\)&lt;script&gt;/);
    assert.doesNotMatch(snippet, /onload="|<script>.*<script/i);
    assert.doesNotMatch(snippet, new RegExp(WORKSPACE_A));
    assert.doesNotMatch(snippet, new RegExp(SITE_A));
    assert.doesNotMatch(snippet, new RegExp(WIDGET_A));
    assert.equal((snippet.match(/data-public-key=/g) ?? []).length, 1);
  } finally {
    await app.close();
  }
});
