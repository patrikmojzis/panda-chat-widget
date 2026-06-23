import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import { loadDatabaseConfig } from './config.ts';
import { closeDatabase, createDatabase } from './db.ts';
import { createMigrator, MIGRATIONS_DIRECTORY } from './migration-runner.ts';

test('MIGRATIONS_DIRECTORY points at the server migrations folder', async () => {
  await access(MIGRATIONS_DIRECTORY);
  assert.match(MIGRATIONS_DIRECTORY, /src\/migrations$/);
});

test('createMigrator builds an explicit Kysely migrator without running it', async () => {
  const database = createDatabase(loadDatabaseConfig({}));

  try {
    const migrator = createMigrator(database);

    assert.equal(typeof migrator.migrateToLatest, 'function');
  } finally {
    await closeDatabase(database);
  }
});
