import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const authDataSource = await readFile(new URL('./auth-data.ts', import.meta.url), 'utf8');

test('first-owner setup uses a transaction-scoped advisory lock before checking for users', () => {
  assert.match(authDataSource, /database\.transaction\(\)\.execute/);
  assert.match(authDataSource, /await acquireSetupLock\(transaction\);/);
  assert.match(authDataSource, /pg_advisory_xact_lock\(809711640, 80\)/);
  assert.match(authDataSource, /if \(await hasAnyUsersInTransaction\(transaction\)\)/);
});
