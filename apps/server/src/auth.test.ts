import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from './app.ts';
import { hashSessionToken } from './auth-session.ts';
import type { DatabaseClient } from './db.ts';

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

type WhereClause = {
  column: string;
  operator: string;
  value: unknown;
};

type FakeAuthDatabase = {
  database: DatabaseClient;
  users: StoredUser[];
  workspaces: StoredWorkspace[];
  authSessions: StoredAuthSession[];
  setupLocks: number;
  transactions: number;
};

const NOW = new Date('2026-01-01T00:00:00.000Z');
const TOKEN_A = 'A'.repeat(43);
const TOKEN_B = 'B'.repeat(43);
const TOKEN_C = 'C'.repeat(43);
const OWNER_RESPONSE = {
  user: { id: 'user-1', email: 'owner@example.test' },
  workspace: { id: 'workspace-1', name: 'Acme Support' },
};

function createFakeAuthDatabase(): FakeAuthDatabase {
  const fake: FakeAuthDatabase = {
    database: {} as DatabaseClient,
    users: [],
    workspaces: [],
    authSessions: [],
    setupLocks: 0,
    transactions: 0,
  };

  const database = {
    transaction: () => ({
      execute: async (callback: (transaction: DatabaseClient) => Promise<unknown>) => {
        fake.transactions += 1;
        return callback(database as unknown as DatabaseClient);
      },
    }),
    selectFrom: (table: string) => createSelectQuery(fake, table),
    insertInto: (table: string) => createInsertQuery(fake, table),
    updateTable: (table: string) => createUpdateQuery(fake, table),
  };

  fake.database = database as unknown as DatabaseClient;

  return fake;
}

function createAuthApp(fake: FakeAuthDatabase, tokens: string[] = [TOKEN_A]) {
  return buildApp({
    database: fake.database,
    auth: {
      acquireSetupLock: async () => {
        fake.setupLocks += 1;
      },
      createSessionToken: () => tokens.shift() ?? TOKEN_C,
      hashPassword: async (password) => `test-hash:${password}`,
      now: () => NOW,
      secureCookies: true,
      verifyPassword: async (password, storedHash) => storedHash === `test-hash:${password}`,
    },
  });
}

function createSelectQuery(fake: FakeAuthDatabase, table: string) {
  const joins: string[] = [];
  const wheres: WhereClause[] = [];

  const query = {
    innerJoin: (joinedTable: string) => {
      joins.push(joinedTable);
      return query;
    },
    select: () => query,
    limit: () => query,
    where: (column: string, operator: string, value: unknown) => {
      wheres.push({ column, operator, value });
      return query;
    },
    executeTakeFirst: async () => executeSelectTakeFirst(fake, table, joins, wheres),
  };

  return query;
}

function executeSelectTakeFirst(
  fake: FakeAuthDatabase,
  table: string,
  joins: string[],
  wheres: WhereClause[],
): unknown {
  if (table === 'users' && joins.length === 0) {
    const email = whereValue(wheres, 'users.email') ?? whereValue(wheres, 'email');
    const user = typeof email === 'string'
      ? fake.users.find((candidate) => candidate.email === email)
      : fake.users[0];

    return user ? { id: user.id } : undefined;
  }

  if (table === 'users' && joins.includes('workspaces')) {
    const email = whereValue(wheres, 'users.email');
    const user = typeof email === 'string'
      ? fake.users.find((candidate) => candidate.email === email)
      : undefined;
    const workspace = user
      ? fake.workspaces.find((candidate) => candidate.owner_user_id === user.id)
      : undefined;

    if (!user || !workspace) {
      return undefined;
    }

    return {
      userId: user.id,
      email: user.email,
      passwordHash: user.password_hash,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    };
  }

  if (table === 'auth_sessions') {
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

  throw new Error(`Unexpected select table: ${table}`);
}

function createInsertQuery(fake: FakeAuthDatabase, table: string) {
  let pendingValues: Record<string, unknown> | undefined;

  const query = {
    values: (values: Record<string, unknown>) => {
      pendingValues = values;
      return query;
    },
    returning: () => query,
    executeTakeFirstOrThrow: async () => {
      if (!pendingValues) {
        throw new Error(`Missing insert values for ${table}`);
      }

      if (table === 'users') {
        const user = {
          id: `user-${fake.users.length + 1}`,
          email: String(pendingValues.email),
          password_hash: String(pendingValues.password_hash),
          created_at: pendingValues.created_at as Date | string,
          updated_at: pendingValues.updated_at as Date | string,
        } satisfies StoredUser;
        fake.users.push(user);

        return { id: user.id, email: user.email };
      }

      if (table === 'workspaces') {
        const workspace = {
          id: `workspace-${fake.workspaces.length + 1}`,
          owner_user_id: String(pendingValues.owner_user_id),
          name: String(pendingValues.name),
          created_at: pendingValues.created_at as Date | string,
          updated_at: pendingValues.updated_at as Date | string,
        } satisfies StoredWorkspace;
        fake.workspaces.push(workspace);

        return { id: workspace.id, name: workspace.name };
      }

      if (table === 'auth_sessions') {
        const session = {
          id: `session-${fake.authSessions.length + 1}`,
          user_id: String(pendingValues.user_id),
          token_hash: String(pendingValues.token_hash),
          created_at: pendingValues.created_at as Date | string,
          last_seen_at: pendingValues.last_seen_at as Date | string,
          expires_at: pendingValues.expires_at as Date | string,
          revoked_at: pendingValues.revoked_at as Date | string | null,
        } satisfies StoredAuthSession;
        fake.authSessions.push(session);

        return { id: session.id };
      }

      throw new Error(`Unexpected insert table: ${table}`);
    },
  };

  return query;
}

function createUpdateQuery(fake: FakeAuthDatabase, table: string) {
  let updates: Partial<StoredAuthSession> = {};
  const wheres: WhereClause[] = [];

  const query = {
    set: (values: Partial<StoredAuthSession>) => {
      updates = values;
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
        if (matchesSessionWhere(session, wheres)) {
          Object.assign(session, updates);
        }
      }
    },
  };

  return query;
}

function matchesSessionWhere(session: StoredAuthSession, wheres: WhereClause[]): boolean {
  return wheres.every((where) => {
    if (where.column === 'id' && where.operator === '=') {
      return session.id === where.value;
    }

    if (where.column === 'token_hash' && where.operator === '=') {
      return session.token_hash === where.value;
    }

    if (where.column === 'revoked_at' && where.operator === 'is') {
      return session.revoked_at === where.value;
    }

    return true;
  });
}

function whereValue(wheres: WhereClause[], column: string): unknown {
  return wheres.find((where) => where.column === column)?.value;
}

function cookieFrom(response: { headers: { [key: string]: unknown } }): string {
  const cookie = response.headers['set-cookie'];

  if (Array.isArray(cookie)) {
    return typeof cookie[0] === 'string' ? cookie[0] : '';
  }

  return typeof cookie === 'string' ? cookie : '';
}

function sessionCookie(token: string): string {
  return `pcw_session=${token}`;
}

test('first-user setup creates the first owner and workspace with a secure HttpOnly session cookie', async () => {
  const fake = createFakeAuthDatabase();
  const app = createAuthApp(fake, [TOKEN_A]);

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: {
        email: ' Owner@Example.TEST ',
        password: 'correct horse battery staple',
        workspaceName: ' Acme Support ',
      },
    });

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), OWNER_RESPONSE);
    assert.doesNotMatch(response.body, /password|sessionToken|token_hash|password_hash/i);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(cookieFrom(response), /^pcw_session=A{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000; Secure$/);
    assert.deepEqual(fake.users.map(({ email, password_hash }) => ({ email, password_hash })), [
      { email: 'owner@example.test', password_hash: 'test-hash:correct horse battery staple' },
    ]);
    assert.deepEqual(fake.workspaces.map(({ owner_user_id, name }) => ({ owner_user_id, name })), [
      { owner_user_id: 'user-1', name: 'Acme Support' },
    ]);
    assert.equal(fake.authSessions.length, 1);
    assert.equal(fake.authSessions[0]?.token_hash, hashSessionToken(TOKEN_A));
    assert.notEqual(fake.authSessions[0]?.token_hash, TOKEN_A);
    assert.equal(fake.setupLocks, 1);
    assert.equal(fake.transactions, 1);
  } finally {
    await app.close();
  }
});

test('first-owner setup is transactionally singleton when setup is submitted twice', async () => {
  const fake = createFakeAuthDatabase();
  const app = createAuthApp(fake, [TOKEN_A, TOKEN_B]);

  try {
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { email: 'owner@example.test', password: 'password-1', workspaceName: 'Acme Support' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { email: 'other@example.test', password: 'password-2', workspaceName: 'Other' },
    });

    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 409);
    assert.deepEqual(second.json(), { error: 'setup_already_completed' });
    assert.equal(fake.users.length, 1);
    assert.equal(fake.workspaces.length, 1);
    assert.equal(fake.authSessions.length, 1);
    assert.equal(fake.setupLocks, 2);
    assert.equal(fake.transactions, 2);
  } finally {
    await app.close();
  }
});

test('login returns a HttpOnly session and /api/me plus /me return the current owner workspace', async () => {
  const fake = createFakeAuthDatabase();
  const app = createAuthApp(fake, [TOKEN_A, TOKEN_B]);

  try {
    await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { email: 'owner@example.test', password: 'correct-password', workspaceName: 'Acme Support' },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ' OWNER@EXAMPLE.TEST ', password: 'correct-password' },
    });

    assert.equal(login.statusCode, 200);
    assert.deepEqual(login.json(), OWNER_RESPONSE);
    assert.equal(login.headers['cache-control'], 'no-store');
    assert.match(cookieFrom(login), /^pcw_session=B{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000; Secure$/);
    assert.equal(fake.authSessions.at(-1)?.token_hash, hashSessionToken(TOKEN_B));

    for (const url of ['/api/me', '/me']) {
      const me = await app.inject({ method: 'GET', url, headers: { cookie: sessionCookie(TOKEN_B) } });

      assert.equal(me.statusCode, 200);
      assert.deepEqual(me.json(), OWNER_RESPONSE);
      assert.equal(me.headers['cache-control'], 'no-store');
    }
  } finally {
    await app.close();
  }
});

test('invalid login does not reveal whether the email exists', async () => {
  const fake = createFakeAuthDatabase();
  const app = createAuthApp(fake, [TOKEN_A]);

  try {
    await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { email: 'owner@example.test', password: 'correct-password', workspaceName: 'Acme Support' },
    });

    const missingUser = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'missing@example.test', password: 'wrong-password' },
    });
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'owner@example.test', password: 'wrong-password' },
    });

    assert.equal(missingUser.statusCode, 401);
    assert.equal(wrongPassword.statusCode, 401);
    assert.deepEqual(missingUser.json(), { error: 'invalid_credentials' });
    assert.deepEqual(wrongPassword.json(), { error: 'invalid_credentials' });
  } finally {
    await app.close();
  }
});

test('protected dashboard APIs return JSON 401 without a valid session and keep public widget APIs unprotected by auth', async () => {
  const fake = createFakeAuthDatabase();
  const app = createAuthApp(fake, [TOKEN_A]);

  try {
    const me = await app.inject({ method: 'GET', url: '/api/me' });
    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard' });

    assert.equal(me.statusCode, 401);
    assert.equal(dashboard.statusCode, 401);
    assert.deepEqual(me.json(), { error: 'unauthenticated' });
    assert.deepEqual(dashboard.json(), { error: 'unauthenticated' });
    assert.equal(dashboard.headers['cache-control'], 'no-store');

    const widgetResponse = await app.inject({ method: 'GET', url: '/api/widgets/%20/bootstrap' });
    assert.notEqual(widgetResponse.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('sessions fail closed when cookies are malformed, expired, or revoked', async () => {
  const fake = createFakeAuthDatabase();
  const app = createAuthApp(fake, [TOKEN_A]);

  try {
    await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { email: 'owner@example.test', password: 'correct-password', workspaceName: 'Acme Support' },
    });

    fake.authSessions.push({
      id: 'session-expired',
      user_id: 'user-1',
      token_hash: hashSessionToken(TOKEN_B),
      created_at: NOW,
      last_seen_at: NOW,
      expires_at: new Date(NOW.getTime() - 1000),
      revoked_at: null,
    });
    fake.authSessions.push({
      id: 'session-revoked',
      user_id: 'user-1',
      token_hash: hashSessionToken(TOKEN_C),
      created_at: NOW,
      last_seen_at: NOW,
      expires_at: new Date(NOW.getTime() + 1000),
      revoked_at: NOW,
    });

    for (const cookie of [
      'pcw_session=short',
      `${sessionCookie(TOKEN_A)}; pcw_session=${TOKEN_A}`,
      sessionCookie(TOKEN_B),
      sessionCookie(TOKEN_C),
    ]) {
      const response = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });

      assert.equal(response.statusCode, 401);
      assert.deepEqual(response.json(), { error: 'unauthenticated' });
    }
  } finally {
    await app.close();
  }
});

test('logout is CSRF-protected and idempotently revokes and clears the session cookie', async () => {
  const fake = createFakeAuthDatabase();
  const app = createAuthApp(fake, [TOKEN_A]);

  try {
    await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { email: 'owner@example.test', password: 'correct-password', workspaceName: 'Acme Support' },
    });

    const csrfFailure = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: sessionCookie(TOKEN_A) },
    });

    assert.equal(csrfFailure.statusCode, 403);
    assert.deepEqual(csrfFailure.json(), {
      error: 'csrf_protection_failed',
      reason: 'missing_csrf_protection',
    });
    assert.equal(fake.authSessions[0]?.revoked_at, null);

    const crossOriginFailure = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: sessionCookie(TOKEN_A),
        host: 'console.example.test',
        origin: 'https://evil.example.test',
        'x-forwarded-proto': 'https',
      },
    });

    assert.equal(crossOriginFailure.statusCode, 403);
    assert.deepEqual(crossOriginFailure.json(), {
      error: 'csrf_protection_failed',
      reason: 'cross_origin_request',
    });
    assert.equal(fake.authSessions[0]?.revoked_at, null);

    const firstLogout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: sessionCookie(TOKEN_A),
        host: 'console.example.test',
        origin: 'https://console.example.test',
        'x-forwarded-proto': 'https',
      },
    });
    const secondLogout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: sessionCookie(TOKEN_A), 'x-panda-csrf': '1' },
    });
    const noCookieLogout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { 'x-panda-csrf': '1' },
    });

    assert.equal(firstLogout.statusCode, 204);
    assert.equal(secondLogout.statusCode, 204);
    assert.equal(noCookieLogout.statusCode, 204);
    assert.match(cookieFrom(firstLogout), /^pcw_session=; HttpOnly; SameSite=Lax; Path=\/; Max-Age=0; Secure$/);
    assert.deepEqual(fake.authSessions.map((session) => session.revoked_at), [NOW]);
  } finally {
    await app.close();
  }
});
