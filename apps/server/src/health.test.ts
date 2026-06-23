import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from './app.ts';

test('GET /healthz returns a minimal ok response', async () => {
  const app = buildApp();

  try {
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });
  } finally {
    await app.close();
  }
});
