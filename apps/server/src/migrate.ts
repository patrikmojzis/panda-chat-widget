import { loadDatabaseConfig } from './config.ts';
import { closeDatabase, createDatabase } from './db.ts';
import { runMigrations } from './migration-runner.ts';
import { safeErrorForLog } from './server-logging.ts';

const database = createDatabase(loadDatabaseConfig());

try {
  const { error, results } = await runMigrations(database);

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`migration ${result.migrationName} completed`);
    } else if (result.status === 'Error') {
      console.error(`migration ${result.migrationName} failed`);
    }
  }

  if (error) {
    console.error('failed to run migrations');
    console.error(safeErrorForLog(error));
    process.exitCode = 1;
  } else if (!results || results.length === 0) {
    console.log('no migrations to run');
  }
} finally {
  await closeDatabase(database);
}
