import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDatabaseConfig } from './config.ts';
import { closeDatabase, createDatabase } from './db.ts';

test('createDatabase builds a Kysely client from explicit config without connecting the server', async () => {
  const database = createDatabase(loadDatabaseConfig({}));

  try {
    assert.equal(typeof database.selectFrom, 'function');
    assert.equal(typeof database.destroy, 'function');
  } finally {
    await closeDatabase(database);
  }
});
