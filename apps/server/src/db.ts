import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { DatabaseConfig } from './config.ts';

export type DatabaseSchema = Record<string, never>;
export type DatabaseClient = Kysely<DatabaseSchema>;

export function createDatabase(config: DatabaseConfig): DatabaseClient {
  const pool = new Pool({ connectionString: config.url });

  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({ pool }),
  });
}

export async function closeDatabase(database: DatabaseClient): Promise<void> {
  await database.destroy();
}
