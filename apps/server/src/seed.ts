import { loadDatabaseConfig } from './config.ts';
import { closeDatabase, createDatabase } from './db.ts';
import { seedDemoData } from './seed-data.ts';

const database = createDatabase(loadDatabaseConfig());

try {
  const result = await seedDemoData(database);

  console.log(`seeded demo widget ${result.publicWidgetKey}`);
  console.log(`allowed domains: ${result.allowedDomains.join(', ')}`);
} catch (error) {
  console.error('failed to seed demo data');
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDatabase(database);
}
