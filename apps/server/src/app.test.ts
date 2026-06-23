import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from './app.ts';
import { listen } from './listen.ts';

test('buildApp creates a Fastify instance without listening', async () => {
  const app = buildApp();

  try {
    assert.equal(app.server.listening, false);
    assert.equal(typeof app.inject, 'function');
  } finally {
    await app.close();
  }
});

test('listen binds an existing app when called', async () => {
  const app = buildApp();

  try {
    const address = await listen(app, { host: '127.0.0.1', port: 0 });

    assert.match(address, /^http:\/\/127\.0\.0\.1:/);
    assert.equal(app.server.listening, true);
  } finally {
    await app.close();
  }
});
