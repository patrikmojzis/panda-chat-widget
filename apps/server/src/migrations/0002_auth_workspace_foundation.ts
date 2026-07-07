import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

export const up: Migration['up'] = async (db) => {
  await sql`
    create table users (
      id uuid primary key default gen_random_uuid(),
      email text not null unique,
      password_hash text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create table workspaces (
      id uuid primary key default gen_random_uuid(),
      owner_user_id uuid not null unique references users(id) on delete restrict,
      name text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create table auth_sessions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      token_hash text not null unique,
      created_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      expires_at timestamptz not null,
      revoked_at timestamptz
    )
  `.execute(db);

  await sql`
    alter table sites
      add column workspace_id uuid references workspaces(id) on delete restrict
  `.execute(db);

  await sql`create index sites_workspace_id_idx on sites(workspace_id)`.execute(db);
  await sql`create index auth_sessions_user_id_expires_at_idx on auth_sessions(user_id, expires_at)`.execute(db);
};

export const down: Migration['down'] = async (db) => {
  await sql`drop index if exists auth_sessions_user_id_expires_at_idx`.execute(db);
  await sql`drop index if exists sites_workspace_id_idx`.execute(db);
  await sql`alter table sites drop column if exists workspace_id`.execute(db);
  await sql`drop table if exists auth_sessions`.execute(db);
  await sql`drop table if exists workspaces`.execute(db);
  await sql`drop table if exists users`.execute(db);
};
