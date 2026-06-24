import { loadDatabaseConfig } from './config.ts';
import { closeDatabase, createDatabase } from './db.ts';
import { seedDemoData } from './seed-data.ts';
import { safeErrorForLog } from './server-logging.ts';

const database = createDatabase(loadDatabaseConfig());

try {
  const result = await seedDemoData(database);

  console.log('seeded demo widget');
  console.log(`allowed domains: ${result.allowedDomains.length}`);
} catch (error) {
  console.error('failed to seed demo data');
  console.error(safeErrorForLog(error));
  process.exitCode = 1;
} finally {
  await closeDatabase(database);
}
