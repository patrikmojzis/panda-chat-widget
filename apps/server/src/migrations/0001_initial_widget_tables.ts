import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

export const up: Migration['up'] = async (db) => {
  await sql`
    create table sites (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create table widgets (
      id uuid primary key default gen_random_uuid(),
      site_id uuid not null references sites(id) on delete cascade,
      public_key text not null unique,
      name text not null,
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create table allowed_domains (
      id uuid primary key default gen_random_uuid(),
      widget_id uuid not null references widgets(id) on delete cascade,
      domain text not null,
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      unique (widget_id, domain)
    )
  `.execute(db);

  await sql`
    create table visitor_sessions (
      id uuid primary key default gen_random_uuid(),
      widget_id uuid not null references widgets(id) on delete cascade,
      visitor_key text not null,
      created_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      unique (widget_id, visitor_key)
    )
  `.execute(db);

  await sql`
    create table conversations (
      id uuid primary key default gen_random_uuid(),
      widget_id uuid not null references widgets(id) on delete cascade,
      visitor_session_id uuid references visitor_sessions(id) on delete set null,
      status text not null default 'open',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      closed_at timestamptz,
      constraint conversations_status_check check (status in ('open', 'closed'))
    )
  `.execute(db);

  await sql`
    create table messages (
      id uuid primary key default gen_random_uuid(),
      conversation_id uuid not null references conversations(id) on delete cascade,
      seq integer not null,
      sender text not null,
      client_message_id text,
      body text not null,
      created_at timestamptz not null default now(),
      constraint messages_seq_positive_check check (seq > 0),
      constraint messages_sender_check check (sender in ('visitor', 'agent', 'system')),
      constraint messages_visitor_client_message_id_check check (sender <> 'visitor' or client_message_id is not null),
      unique (conversation_id, seq)
    )
  `.execute(db);

  await sql`create index widgets_site_id_idx on widgets(site_id)`.execute(db);
  await sql`create index allowed_domains_widget_id_idx on allowed_domains(widget_id)`.execute(db);
  await sql`create index visitor_sessions_widget_id_idx on visitor_sessions(widget_id)`.execute(db);
  await sql`create index conversations_widget_status_created_at_idx on conversations(widget_id, status, created_at)`.execute(db);
  await sql`create index conversations_visitor_session_id_idx on conversations(visitor_session_id)`.execute(db);
  await sql`create index messages_conversation_created_at_idx on messages(conversation_id, created_at)`.execute(db);
  await sql`
    create unique index messages_conversation_client_message_id_idx
      on messages(conversation_id, client_message_id)
      where client_message_id is not null
  `.execute(db);
};

export const down: Migration['down'] = async (db) => {
  await sql`drop table if exists messages`.execute(db);
  await sql`drop table if exists conversations`.execute(db);
  await sql`drop table if exists visitor_sessions`.execute(db);
  await sql`drop table if exists allowed_domains`.execute(db);
  await sql`drop table if exists widgets`.execute(db);
  await sql`drop table if exists sites`.execute(db);
};
