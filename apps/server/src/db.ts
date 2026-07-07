import { Kysely, PostgresDialect } from 'kysely';
import type { ColumnType, Generated } from 'kysely';
import { Pool } from 'pg';

import type { DatabaseConfig } from './config.ts';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type NullableText = ColumnType<string | null, string | null | undefined, string | null>;

export type ConversationStatus = 'open' | 'closed';
export type MessageSender = 'visitor' | 'agent' | 'system';

export type UsersTable = {
  id: Generated<string>;
  email: string;
  password_hash: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type WorkspacesTable = {
  id: Generated<string>;
  owner_user_id: string;
  name: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type AuthSessionsTable = {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  created_at: Timestamp;
  last_seen_at: Timestamp;
  expires_at: Timestamp;
  revoked_at: NullableTimestamp;
};

export type SitesTable = {
  id: Generated<string>;
  workspace_id: NullableText;
  name: string;
  enabled: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type WidgetsTable = {
  id: Generated<string>;
  site_id: string;
  public_key: string;
  name: string;
  assistant_display_name: Generated<string>;
  launcher_label: Generated<string>;
  launcher_icon: Generated<string>;
  welcome_title: Generated<string>;
  welcome_subtitle: Generated<string>;
  theme_color_mode: Generated<string>;
  theme_accent: Generated<string>;
  theme_radius: Generated<string>;
  enabled: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type AllowedDomainsTable = {
  id: Generated<string>;
  widget_id: string;
  domain: string;
  enabled: Generated<boolean>;
  created_at: Timestamp;
};

export type VisitorSessionsTable = {
  id: Generated<string>;
  widget_id: string;
  visitor_key: string;
  created_at: Timestamp;
  last_seen_at: Timestamp;
};

export type ConversationsTable = {
  id: Generated<string>;
  widget_id: string;
  visitor_session_id: NullableText;
  status: Generated<ConversationStatus>;
  created_at: Timestamp;
  updated_at: Timestamp;
  closed_at: NullableTimestamp;
};

export type MessagesTable = {
  id: Generated<string>;
  conversation_id: string;
  seq: number;
  sender: MessageSender;
  client_message_id: NullableText;
  body: string;
  created_at: Timestamp;
};

export type DatabaseSchema = {
  users: UsersTable;
  workspaces: WorkspacesTable;
  auth_sessions: AuthSessionsTable;
  sites: SitesTable;
  widgets: WidgetsTable;
  allowed_domains: AllowedDomainsTable;
  visitor_sessions: VisitorSessionsTable;
  conversations: ConversationsTable;
  messages: MessagesTable;
};

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
