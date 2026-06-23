import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { FileMigrationProvider, Migrator, type MigrationResultSet } from 'kysely/migration';

import type { DatabaseClient } from './db.ts';

export const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('./migrations', import.meta.url));

export type CreateMigratorOptions = {
  migrationFolder?: string;
};

export function createMigrator(database: DatabaseClient, options: CreateMigratorOptions = {}): Migrator {
  const migrationFolder = options.migrationFolder ?? MIGRATIONS_DIRECTORY;

  return new Migrator({
    db: database,
    provider: new FileMigrationProvider({
      fs,
      import: (modulePath) => import(pathToFileURL(modulePath).href),
      migrationFolder,
      path,
    }),
  });
}

export async function runMigrations(
  database: DatabaseClient,
  options: CreateMigratorOptions = {},
): Promise<MigrationResultSet> {
  return createMigrator(database, options).migrateToLatest();
}
