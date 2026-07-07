import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

export const up: Migration['up'] = async (db) => {
  await sql`alter table panda_delivery_intents add column claimed_at timestamptz`.execute(db);
  await sql`alter table panda_delivery_intents drop constraint panda_delivery_intents_status_check`.execute(db);
  await sql`
    alter table panda_delivery_intents
      add constraint panda_delivery_intents_status_check check (status in ('queued', 'claimed'))
  `.execute(db);
};

export const down: Migration['down'] = async (db) => {
  await sql`update panda_delivery_intents set status = 'queued' where status = 'claimed'`.execute(db);
  await sql`alter table panda_delivery_intents drop constraint panda_delivery_intents_status_check`.execute(db);
  await sql`
    alter table panda_delivery_intents
      add constraint panda_delivery_intents_status_check check (status in ('queued'))
  `.execute(db);
  await sql`alter table panda_delivery_intents drop column claimed_at`.execute(db);
};
