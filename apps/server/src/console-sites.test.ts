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
const SITE_B = '30000000-0000-4000-8000-000000000002';
const SITE_DEMO = '30000000-0000-4000-8000-000000000003';
const WIDGET_B = '40000000-0000-4000-8000-000000000001';

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
  name: string;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
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

type InsertLog = {
  table: string;
  values: Record<string, unknown>;
};

type FakeConsoleDatabase = {
  database: DatabaseClient;
  users: StoredUser[];
  workspaces: StoredWorkspace[];
  authSessions: StoredAuthSession[];
  sites: StoredSite[];
  widgets: StoredWidget[];
  selects: SelectLog[];
  inserts: InsertLog[];
};

function createFakeConsoleDatabase(): FakeConsoleDatabase {
  const fake: FakeConsoleDatabase = {
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
      {
        id: SITE_A,
        workspace_id: WORKSPACE_A,
        name: 'Alpha Site',
        enabled: true,
        created_at: new Date('2026-01-01T01:00:00.000Z'),
        updated_at: new Date('2026-01-01T01:00:00.000Z'),
      },
      {
        id: SITE_B,
        workspace_id: WORKSPACE_B,
        name: 'Beta Site',
        enabled: true,
        created_at: new Date('2026-01-01T02:00:00.000Z'),
        updated_at: new Date('2026-01-01T02:00:00.000Z'),
      },
      {
        id: SITE_DEMO,
        workspace_id: null,
        name: 'Demo Local Site',
        enabled: true,
        created_at: new Date('2026-01-01T03:00:00.000Z'),
        updated_at: new Date('2026-01-01T03:00:00.000Z'),
      },
    ],
    widgets: [
      {
        id: WIDGET_B,
        site_id: SITE_B,
        public_key: 'workspace-b-widget',
        name: 'Beta Widget',
        enabled: true,
        created_at: new Date('2026-01-01T04:00:00.000Z'),
        updated_at: new Date('2026-01-01T04:00:00.000Z'),
      },
    ],
    selects: [],
    inserts: [],
  };

  const database = {
    selectFrom: (table: string) => createSelectQuery(fake, table),
    insertInto: (table: string) => createInsertQuery(fake, table),
    updateTable: (table: string) => createUpdateQuery(fake, table),
  };

  fake.database = database as unknown as DatabaseClient;

  return fake;
}

function createConsoleApp(fake: FakeConsoleDatabase) {
  return buildApp({
    database: fake.database,
    auth: {
      now: () => NOW,
    },
  });
}

function createSelectQuery(fake: FakeConsoleDatabase, table: string) {
  const joins: string[] = [];
  const wheres: WhereClause[] = [];
  const orders: OrderClause[] = [];

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
    limit: () => query,
    execute: async () => {
      fake.selects.push(cloneSelectLog(table, joins, wheres, orders, 'execute'));
      return selectRows(fake, table, wheres, orders);
    },
    executeTakeFirst: async () => {
      fake.selects.push(cloneSelectLog(table, joins, wheres, orders, 'executeTakeFirst'));
      return selectRows(fake, table, wheres, orders)[0];
    },
  };

  return query;
}

function createInsertQuery(fake: FakeConsoleDatabase, table: string) {
  let pendingValues: Record<string, unknown> | undefined;

  const query = {
    values: (values: Record<string, unknown>) => {
      pendingValues = { ...values };
      return query;
    },
    returning: () => query,
    executeTakeFirstOrThrow: async () => {
      if (!pendingValues) {
        throw new Error(`Missing insert values for ${table}`);
      }

      fake.inserts.push({ table, values: { ...pendingValues } });

      if (table === 'sites') {
        const site = {
          id: generatedUuid(fake.sites.length + 1),
          workspace_id: stringOrNull(pendingValues.workspace_id),
          name: String(pendingValues.name),
          enabled: pendingValues.enabled === true,
          created_at: dateValue(pendingValues.created_at),
          updated_at: dateValue(pendingValues.updated_at),
        } satisfies StoredSite;
        fake.sites.push(site);

        return site;
      }

      if (table === 'widgets') {
        const widget = {
          id: generatedUuid(fake.widgets.length + 1),
          site_id: String(pendingValues.site_id),
          public_key: String(pendingValues.public_key),
          name: String(pendingValues.name),
          enabled: pendingValues.enabled === true,
          created_at: dateValue(pendingValues.created_at),
          updated_at: dateValue(pendingValues.updated_at),
        } satisfies StoredWidget;
        fake.widgets.push(widget);

        return widget;
      }

      throw new Error(`Unexpected insert table: ${table}`);
    },
  };

  return query;
}

function createUpdateQuery(fake: FakeConsoleDatabase, table: string) {
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
      if (table !== 'auth_sessions') {
        throw new Error(`Unexpected update table: ${table}`);
      }

      for (const session of fake.authSessions) {
        if (matchesWhereClauses(session, wheres)) {
          Object.assign(session, updates);
        }
      }
    },
  };

  return query;
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

function selectRows(
  fake: FakeConsoleDatabase,
  table: string,
  wheres: WhereClause[],
  orders: OrderClause[],
): unknown[] {
  if (table === 'auth_sessions') {
    const authRow = selectAuthSessionRow(fake, wheres);

    return authRow ? [authRow] : [];
  }

  if (table === 'sites') {
    return sortRows(fake.sites.filter((site) => matchesWhereClauses(site, wheres)), orders);
  }

  if (table === 'widgets') {
    return sortRows(fake.widgets.filter((widget) => matchesWhereClauses(widget, wheres)), orders);
  }

  throw new Error(`Unexpected select table: ${table}`);
}

function selectAuthSessionRow(fake: FakeConsoleDatabase, wheres: WhereClause[]): unknown | undefined {
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

function matchesWhereClauses(row: Record<string, unknown>, wheres: WhereClause[]): boolean {
  return wheres.every((where) => {
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

    return true;
  });
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

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function dateValue(value: unknown): Date | string {
  return value instanceof Date || typeof value === 'string' ? value : NOW;
}

function generatedUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
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

function hasWhere(log: SelectLog, column: string, value: unknown): boolean {
  return log.wheres.some((where) =>
    unqualifiedColumn(where.column) === column && where.operator === '=' && where.value === value,
  );
}

function assertWorkspaceScopedSiteQuery(fake: FakeConsoleDatabase, workspaceId: string, siteId?: string): void {
  assert.equal(
    fake.selects.some((log) => {
      if (log.table !== 'sites' || !hasWhere(log, 'workspace_id', workspaceId)) {
        return false;
      }

      return siteId === undefined || hasWhere(log, 'id', siteId);
    }),
    true,
    `expected a sites query scoped to workspace ${workspaceId}${siteId ? ` and site ${siteId}` : ''}`,
  );
}

test('console site/widget APIs return JSON 401 without a session before CSRF checks', async () => {
  const fake = createFakeConsoleDatabase();
  const app = createConsoleApp(fake);

  try {
    for (const route of [
      { method: 'GET', url: '/api/console/sites' },
      { method: 'POST', url: '/api/console/sites', payload: { name: 'No session site' } },
      { method: 'GET', url: `/api/console/sites/${SITE_A}` },
      { method: 'GET', url: `/api/console/sites/${SITE_A}/widgets` },
      { method: 'POST', url: `/api/console/sites/${SITE_A}/widgets`, payload: { name: 'No session widget' } },
    ] as const) {
      const response = await app.inject(route);

      assert.equal(response.statusCode, 401);
      assert.match(response.headers['content-type'] ?? '', /^application\/json/);
      assert.deepEqual(response.json(), { error: 'unauthenticated' });
    }

    assert.equal(fake.inserts.length, 0);
    assert.equal(fake.sites.length, 3);
    assert.equal(fake.widgets.length, 1);
  } finally {
    await app.close();
  }
});

test('console POST routes reject missing CSRF with a valid session and perform no writes', async () => {
  const fake = createFakeConsoleDatabase();
  const app = createConsoleApp(fake);

  try {
    const site = await app.inject({
      method: 'POST',
      url: '/api/console/sites',
      headers: { cookie: sessionCookie(TOKEN_A) },
      payload: { name: 'CSRF site' },
    });
    const widget = await app.inject({
      method: 'POST',
      url: `/api/console/sites/${SITE_A}/widgets`,
      headers: { cookie: sessionCookie(TOKEN_A) },
      payload: { name: 'CSRF widget' },
    });

    assert.equal(site.statusCode, 403);
    assert.equal(widget.statusCode, 403);
    assert.deepEqual(site.json(), { error: 'csrf_protection_failed', reason: 'missing_csrf_protection' });
    assert.deepEqual(widget.json(), { error: 'csrf_protection_failed', reason: 'missing_csrf_protection' });
    assert.equal(fake.inserts.length, 0);
    assert.equal(fake.sites.length, 3);
    assert.equal(fake.widgets.length, 1);
  } finally {
    await app.close();
  }
});

test('console site list/read/create uses authenticated workspace and ignores submitted workspace IDs', async () => {
  const fake = createFakeConsoleDatabase();
  const app = createConsoleApp(fake);

  try {
    const list = await app.inject({
      method: 'GET',
      url: '/api/console/sites',
      headers: { cookie: sessionCookie(TOKEN_A) },
    });

    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.json(), {
      sites: [
        {
          id: SITE_A,
          workspaceId: WORKSPACE_A,
          name: 'Alpha Site',
          enabled: true,
          createdAt: '2026-01-01T01:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
        },
      ],
    });
    assertWorkspaceScopedSiteQuery(fake, WORKSPACE_A);

    const otherWorkspaceSite = await app.inject({
      method: 'GET',
      url: `/api/console/sites/${SITE_B}`,
      headers: { cookie: sessionCookie(TOKEN_A) },
    });

    assert.equal(otherWorkspaceSite.statusCode, 404);
    assert.deepEqual(otherWorkspaceSite.json(), { error: 'site_not_found' });
    assertWorkspaceScopedSiteQuery(fake, WORKSPACE_A, SITE_B);

    const create = await app.inject({
      method: 'POST',
      url: '/api/console/sites',
      headers: csrfHeaders(TOKEN_A),
      payload: {
        name: '  New Console Site  ',
        workspaceId: WORKSPACE_B,
      },
    });

    assert.equal(create.statusCode, 201);
    assert.equal(create.json().site.workspaceId, WORKSPACE_A);
    assert.equal(create.json().site.name, 'New Console Site');

    const insertedSite = fake.sites.find((site) => site.name === 'New Console Site');
    const siteInsert = fake.inserts.find((insert) => insert.table === 'sites');

    assert.equal(insertedSite?.workspace_id, WORKSPACE_A);
    assert.equal(siteInsert?.values.workspace_id, WORKSPACE_A);
    assert.equal('workspaceId' in (siteInsert?.values ?? {}), false);
  } finally {
    await app.close();
  }
});

test('console widget list/create requires site ownership and ignores submitted public keys', async () => {
  const fake = createFakeConsoleDatabase();
  const app = createConsoleApp(fake);

  try {
    const otherWorkspaceWidgetList = await app.inject({
      method: 'GET',
      url: `/api/console/sites/${SITE_B}/widgets`,
      headers: { cookie: sessionCookie(TOKEN_A) },
    });

    assert.equal(otherWorkspaceWidgetList.statusCode, 404);
    assert.deepEqual(otherWorkspaceWidgetList.json(), { error: 'site_not_found' });
    assertWorkspaceScopedSiteQuery(fake, WORKSPACE_A, SITE_B);

    const otherWorkspaceWidgetCreate = await app.inject({
      method: 'POST',
      url: `/api/console/sites/${SITE_B}/widgets`,
      headers: csrfHeaders(TOKEN_A),
      payload: { name: 'Wrong workspace widget' },
    });

    assert.equal(otherWorkspaceWidgetCreate.statusCode, 404);
    assert.deepEqual(otherWorkspaceWidgetCreate.json(), { error: 'site_not_found' });
    assert.equal(fake.widgets.length, 1);
    assert.equal(fake.inserts.some((insert) => insert.table === 'widgets'), false);
    assertWorkspaceScopedSiteQuery(fake, WORKSPACE_A, SITE_B);

    const create = await app.inject({
      method: 'POST',
      url: `/api/console/sites/${SITE_A}/widgets`,
      headers: csrfHeaders(TOKEN_A),
      payload: {
        name: '  Support Widget  ',
        publicKey: 'client-supplied-public-key',
      },
    });

    assert.equal(create.statusCode, 201);
    assert.equal(create.json().widget.siteId, SITE_A);
    assert.equal(create.json().widget.name, 'Support Widget');
    assert.notEqual(create.json().widget.publicKey, 'client-supplied-public-key');
    assert.match(create.json().widget.publicKey, /^widget_[0-9a-f-]{36}$/);

    const insertedWidget = fake.widgets.find((widget) => widget.site_id === SITE_A);
    const widgetInsert = fake.inserts.find((insert) => insert.table === 'widgets');

    assert.equal(insertedWidget?.public_key, create.json().widget.publicKey);
    assert.equal(widgetInsert?.values.site_id, SITE_A);
    assert.equal(widgetInsert?.values.public_key, create.json().widget.publicKey);
    assert.equal(widgetInsert?.values.public_key, insertedWidget?.public_key);
    assert.equal(widgetInsert?.values.publicKey, undefined);
    assertWorkspaceScopedSiteQuery(fake, WORKSPACE_A, SITE_A);

    const list = await app.inject({
      method: 'GET',
      url: `/api/console/sites/${SITE_A}/widgets`,
      headers: { cookie: sessionCookie(TOKEN_A) },
    });

    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.json().widgets.map((widget: { publicKey: string }) => widget.publicKey), [
      create.json().widget.publicKey,
    ]);
    assert.equal(
      fake.selects.some((log) => log.table === 'widgets' && hasWhere(log, 'site_id', SITE_A)),
      true,
      'expected widget list query scoped to the requested owned site',
    );
  } finally {
    await app.close();
  }
});
