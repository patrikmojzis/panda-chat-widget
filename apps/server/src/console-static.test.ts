import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildApp } from './app.ts';
import { hashSessionToken } from './auth-session.ts';
import { resolveConsoleDistFile } from './console-static.ts';
import type { DatabaseClient } from './db.ts';

const TOKEN = 'D'.repeat(43);

function createConsoleAuthDatabase(): DatabaseClient {
  const selectQuery = {
    innerJoin: () => selectQuery,
    select: () => selectQuery,
    where: () => selectQuery,
    executeTakeFirst: async () => ({
      sessionId: 'session-1',
      userId: 'user-1',
      email: 'owner@example.test',
      workspaceId: 'workspace-1',
      workspaceName: 'Acme Support',
    }),
  };
  const updateQuery = {
    set: () => updateQuery,
    where: () => updateQuery,
    execute: async () => undefined,
  };

  return {
    selectFrom: (table: string) => {
      if (table !== 'auth_sessions') {
        throw new Error(`Unexpected select table: ${table}`);
      }

      return selectQuery;
    },
    updateTable: (table: string) => {
      if (table !== 'auth_sessions') {
        throw new Error(`Unexpected update table: ${table}`);
      }

      return updateQuery;
    },
  } as unknown as DatabaseClient;
}

async function createConsoleDistFixture(): Promise<string> {
  const distPath = await mkdtemp(path.join(os.tmpdir(), 'panda-chat-console-dist-'));
  await mkdir(path.join(distPath, 'assets'), { recursive: true });
  await writeFile(path.join(distPath, 'index.html'), '<!doctype html><div id="root">Console shell</div>');
  await writeFile(path.join(distPath, 'assets', 'app.js'), 'console.log("console asset");');
  await writeFile(path.join(distPath, 'assets', 'app.css'), 'body { color: black; }');

  return distPath;
}

function sessionCookie(): string {
  return `pcw_session=${TOKEN}`;
}

test('console login and setup shells are reachable while protected console redirects without a valid session', async () => {
  const distPath = await createConsoleDistFixture();
  const app = buildApp({ database: createConsoleAuthDatabase(), console: { distPath } });

  try {
    const login = await app.inject({ method: 'GET', url: '/console/login' });
    const setup = await app.inject({ method: 'GET', url: '/console/setup' });
    const protectedShell = await app.inject({ method: 'GET', url: '/console' });
    const protectedDeepLink = await app.inject({ method: 'GET', url: '/console/sites/site-1/widgets/widget-1' });

    assert.equal(login.statusCode, 200);
    assert.match(login.headers['content-type'] ?? '', /^text\/html/);
    assert.match(login.body, /Console shell/);
    assert.equal(setup.statusCode, 200);
    assert.equal(protectedShell.statusCode, 302);
    assert.equal(protectedShell.headers.location, '/console/login');
    assert.equal(protectedDeepLink.statusCode, 302);
    assert.equal(protectedDeepLink.headers.location, '/console/login');
  } finally {
    await app.close();
    await rm(distPath, { force: true, recursive: true });
  }
});

test('authenticated console shell loads and protected APIs still return JSON 401 instead of redirects', async () => {
  const distPath = await createConsoleDistFixture();
  const app = buildApp({ database: createConsoleAuthDatabase(), console: { distPath } });

  try {
    assert.equal(hashSessionToken(TOKEN).length, 43);

    const shell = await app.inject({ method: 'GET', url: '/console', headers: { cookie: sessionCookie() } });
    const deepLink = await app.inject({
      method: 'GET',
      url: '/console/sites/site-1/widgets/widget-1',
      headers: { cookie: sessionCookie() },
    });
    const api = await app.inject({ method: 'GET', url: '/api/dashboard' });

    assert.equal(shell.statusCode, 200);
    assert.match(shell.body, /Console shell/);
    assert.equal(deepLink.statusCode, 200);
    assert.match(deepLink.body, /Console shell/);
    assert.equal(api.statusCode, 401);
    assert.match(api.headers['content-type'] ?? '', /^application\/json/);
    assert.deepEqual(api.json(), { error: 'unauthenticated' });
  } finally {
    await app.close();
    await rm(distPath, { force: true, recursive: true });
  }
});


test('protected console shell fails closed when session validation is unavailable', async () => {
  const distPath = await createConsoleDistFixture();
  const brokenDatabase = {
    selectFrom: () => {
      throw new Error('database unavailable');
    },
  } as unknown as DatabaseClient;
  const app = buildApp({ database: brokenDatabase, console: { distPath } });

  try {
    const response = await app.inject({ method: 'GET', url: '/console', headers: { cookie: sessionCookie() } });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'internal_server_error' });
    assert.doesNotMatch(response.body, /Console shell/);
  } finally {
    await app.close();
    await rm(distPath, { force: true, recursive: true });
  }
});

test('console assets are served only from resolved dist paths and reject traversal', async () => {
  const distPath = await createConsoleDistFixture();
  const app = buildApp({ database: createConsoleAuthDatabase(), console: { distPath } });

  try {
    const asset = await app.inject({ method: 'GET', url: '/console/assets/app.js' });
    const stylesheet = await app.inject({ method: 'GET', url: '/console/assets/app.css' });
    const rawTraversal = await app.inject({ method: 'GET', url: '/console/assets/../index.html' });
    const traversal = await app.inject({ method: 'GET', url: '/console/assets/%2e%2e/index.html' });
    const malformedPath = await app.inject({ method: 'GET', url: '/console/assets/%E0%A4%A' });

    assert.equal(asset.statusCode, 200);
    assert.match(asset.headers['content-type'] ?? '', /^text\/javascript/);
    assert.match(asset.body, /console asset/);
    assert.equal(stylesheet.statusCode, 200);
    assert.match(stylesheet.headers['content-type'] ?? '', /^text\/css/);
    assert.equal(resolveConsoleDistFile(distPath, '/assets/app.js'), path.join(distPath, 'assets', 'app.js'));
    assert.equal(resolveConsoleDistFile(distPath, '/assets/%2e%2e/index.html'), null);
    assert.equal(rawTraversal.statusCode, 404);
    assert.equal(traversal.statusCode, 404);
    assert.equal(malformedPath.statusCode, 400);
    assert.doesNotMatch(malformedPath.body, /Console shell/);
  } finally {
    await app.close();
    await rm(distPath, { force: true, recursive: true });
  }
});

test('encoded and malformed asset-like console paths return 404 instead of SPA index', async () => {
  const distPath = await createConsoleDistFixture();
  const app = buildApp({ database: createConsoleAuthDatabase(), console: { distPath } });

  try {
    const encodedSlash = await app.inject({
      method: 'GET',
      url: '/console/assets%2fmissing.js',
      headers: { cookie: sessionCookie() },
    });
    const encodedTraversal = await app.inject({
      method: 'GET',
      url: '/console/assets%2f..%2findex.html',
      headers: { cookie: sessionCookie() },
    });
    const doubleEncodedTraversal = await app.inject({
      method: 'GET',
      url: '/console/assets%252f..%252findex.html',
      headers: { cookie: sessionCookie() },
    });
    const encodedBackslash = await app.inject({
      method: 'GET',
      url: '/console/assets%5cmissing.js',
      headers: { cookie: sessionCookie() },
    });
    const doubleSlash = await app.inject({
      method: 'GET',
      url: '/console//assets/missing.js',
      headers: { cookie: sessionCookie() },
    });

    for (const [label, response] of [
      ['encoded slash', encodedSlash],
      ['encoded traversal', encodedTraversal],
      ['double-encoded traversal', doubleEncodedTraversal],
      ['encoded backslash', encodedBackslash],
      ['double slash', doubleSlash],
    ] as const) {
      assert.equal(response.statusCode, 404, `${label} should be 404, got ${response.statusCode}`);
      assert.doesNotMatch(response.body, /Console shell/, `${label} must not return SPA index`);
    }
  } finally {
    await app.close();
    await rm(distPath, { force: true, recursive: true });
  }
});

test('legitimate SPA deep links still work with authentication', async () => {
  const distPath = await createConsoleDistFixture();
  const app = buildApp({ database: createConsoleAuthDatabase(), console: { distPath } });

  try {
    const deepLink = await app.inject({
      method: 'GET',
      url: '/console/sites/site-1/widgets/widget-1',
      headers: { cookie: sessionCookie() },
    });
    const settings = await app.inject({
      method: 'GET',
      url: '/console/settings',
      headers: { cookie: sessionCookie() },
    });

    assert.equal(deepLink.statusCode, 200);
    assert.match(deepLink.body, /Console shell/);
    assert.equal(settings.statusCode, 200);
    assert.match(settings.body, /Console shell/);
  } finally {
    await app.close();
    await rm(distPath, { force: true, recursive: true });
  }
});

test('unauthenticated encoded asset-like paths return 404 not redirect', async () => {
  const distPath = await createConsoleDistFixture();
  const app = buildApp({ database: createConsoleAuthDatabase(), console: { distPath } });

  try {
    const encodedSlash = await app.inject({
      method: 'GET',
      url: '/console/assets%2fmissing.js',
    });
    const encodedBackslash = await app.inject({
      method: 'GET',
      url: '/console/assets%5cmissing.js',
    });

    assert.equal(encodedSlash.statusCode, 404);
    assert.equal(encodedBackslash.statusCode, 404);
  } finally {
    await app.close();
    await rm(distPath, { force: true, recursive: true });
  }
});
