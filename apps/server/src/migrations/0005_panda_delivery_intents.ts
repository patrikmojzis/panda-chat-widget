import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

export const up: Migration['up'] = async (db) => {
  await sql`
    create table panda_delivery_intents (
      id uuid primary key default gen_random_uuid(),
      widget_id uuid not null references widgets(id) on delete cascade,
      conversation_id uuid not null references conversations(id) on delete cascade,
      visitor_session_id uuid not null references visitor_sessions(id) on delete cascade,
      visitor_message_id uuid not null references messages(id) on delete cascade,
      client_message_id text not null,
      route_handle_snapshot text not null,
      status text not null default 'queued',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint panda_delivery_intents_status_check check (status in ('queued')),
      unique (visitor_message_id)
    )
  `.execute(db);

  await sql`
    create index panda_delivery_intents_status_created_at_idx
      on panda_delivery_intents(status, created_at)
  `.execute(db);
  await sql`
    create index panda_delivery_intents_widget_created_at_idx
      on panda_delivery_intents(widget_id, created_at)
  `.execute(db);
  await sql`
    create index panda_delivery_intents_conversation_id_idx
      on panda_delivery_intents(conversation_id)
  `.execute(db);
};

export const down: Migration['down'] = async (db) => {
  await sql`drop table if exists panda_delivery_intents`.execute(db);
};
