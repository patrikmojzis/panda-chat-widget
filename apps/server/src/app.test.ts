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


test('buildApp returns a generic 500 without exposing thrown internals', async () => {
  const app = buildApp();

  app.get('/boom', async () => {
    throw new Error('visitor-key secret, message body secret, public token secret');
  });

  try {
    const response = await app.inject({ method: 'GET', url: '/boom' });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'internal_server_error' });
    assert.doesNotMatch(response.body, /visitor-key|message body|public token|secret/i);
  } finally {
    await app.close();
  }
});
