import assert from 'node:assert/strict';
import test from 'node:test';

import type { FastifyInstance } from 'fastify';

import type { BuildAppOptions } from './app.ts';
import type { DatabaseClient } from './db.ts';
import type { ListenOptions } from './listen.ts';
import { startServerRuntime } from './server-runtime.ts';

type FakeApp = FastifyInstance & {
  closeHooks: Array<() => Promise<void>>;
  errors: unknown[];
};

function createFakeApp(): FakeApp {
  const closeHooks: Array<() => Promise<void>> = [];
  const errors: unknown[] = [];

  return {
    closeHooks,
    errors,
    addHook: (event: string, hook: () => Promise<void>) => {
      if (event === 'onClose') {
        closeHooks.push(hook);
      }
    },
    close: async () => {
      for (const hook of closeHooks) {
        await hook();
      }
    },
    log: {
      error: (payload: unknown) => {
        errors.push(payload);
      },
    },
  } as unknown as FakeApp;
}

test('server runtime creates one DB client, injects it into buildApp, and closes it with the app', async () => {
  const app = createFakeApp();
  const database = { destroy: async () => undefined } as unknown as DatabaseClient;
  let buildOptions: BuildAppOptions | undefined;
  let listenOptions: ListenOptions | undefined;
  let closedDatabase: DatabaseClient | undefined;

  const runtime = await startServerRuntime({
    loadConfig: () => ({ listen: { host: '127.0.0.1', port: 0 }, logger: false }),
    loadDatabaseConfig: () => ({ url: 'postgresql://user:pass@127.0.0.1:5432/widget' }),
    createDatabase: () => database,
    buildApp: (options) => {
      buildOptions = options;
      return app;
    },
    listen: async (_app, options) => {
      listenOptions = options;
      return 'http://127.0.0.1:3001';
    },
    closeDatabase: async (client) => {
      closedDatabase = client;
    },
  });

  assert.equal(runtime?.app, app);
  assert.equal(runtime?.database, database);
  assert.equal(buildOptions?.database, database);
  assert.equal(buildOptions?.logger, false);
  assert.deepEqual(listenOptions, { host: '127.0.0.1', port: 0 });
  assert.equal(closedDatabase, undefined);

  await app.close();

  assert.equal(closedDatabase, database);
});

test('server runtime closes the DB-backed app and sets exit code when listen fails', async () => {
  const app = createFakeApp();
  const database = { destroy: async () => undefined } as unknown as DatabaseClient;
  const closedDatabases: DatabaseClient[] = [];
  const exitCodes: number[] = [];

  const runtime = await startServerRuntime({
    loadConfig: () => ({ listen: { host: '127.0.0.1', port: 3000 }, logger: true }),
    loadDatabaseConfig: () => ({ url: 'postgresql://user:pass@127.0.0.1:5432/widget' }),
    createDatabase: () => database,
    buildApp: () => app,
    listen: async () => {
      throw new Error('port already in use');
    },
    closeDatabase: async (client) => {
      closedDatabases.push(client);
    },
    setExitCode: (exitCode) => {
      exitCodes.push(exitCode);
    },
  });

  assert.equal(runtime, null);
  assert.deepEqual(closedDatabases, [database]);
  assert.deepEqual(exitCodes, [1]);
  assert.equal(app.errors.length, 1);
});
