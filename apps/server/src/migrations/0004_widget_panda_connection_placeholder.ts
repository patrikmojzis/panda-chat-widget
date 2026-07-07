import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

export const up: Migration['up'] = async (db) => {
  await sql`
    alter table widgets
      add column panda_route_handle text
  `.execute(db);
};

export const down: Migration['down'] = async (db) => {
  await sql`
    alter table widgets
      drop column if exists panda_route_handle
  `.execute(db);
};
