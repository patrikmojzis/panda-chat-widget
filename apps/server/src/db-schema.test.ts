import assert from 'node:assert/strict';
import test from 'node:test';

import type { Insertable, Updateable } from 'kysely';
import type { DatabaseSchema } from './db.ts';

test('DatabaseSchema exposes auth, workspace, and widget tables', () => {
  const tableNames = [
    'users',
    'workspaces',
    'auth_sessions',
    'sites',
    'widgets',
    'allowed_domains',
    'visitor_sessions',
    'conversations',
    'messages',
  ] satisfies Array<keyof DatabaseSchema>;

  assert.deepEqual(tableNames, [
    'users',
    'workspaces',
    'auth_sessions',
    'sites',
    'widgets',
    'allowed_domains',
    'visitor_sessions',
    'conversations',
    'messages',
  ]);
});

test('message inserts support ordering and visitor idempotency', () => {
  const visitorMessage = {
    conversation_id: 'conversation-id',
    seq: 1,
    sender: 'visitor',
    client_message_id: 'client-message-id',
    body: 'Hello',
  } satisfies Insertable<DatabaseSchema['messages']>;

  const agentMessage = {
    conversation_id: 'conversation-id',
    seq: 2,
    sender: 'agent',
    client_message_id: null,
    body: 'Hi',
  } satisfies Insertable<DatabaseSchema['messages']>;

  assert.equal(visitorMessage.seq, 1);
  assert.equal(visitorMessage.sender, 'visitor');
  assert.equal(visitorMessage.client_message_id, 'client-message-id');
  assert.equal(agentMessage.sender, 'agent');
});


test('widget inserts can rely on DB defaults while safe bootstrap settings are updateable', () => {
  const widgetInsert = {
    site_id: 'site-id',
    public_key: 'widget-public-key',
    name: 'Support Widget',
  } satisfies Insertable<DatabaseSchema['widgets']>;

  const widgetSafeSettingsUpdate = {
    name: 'Updated Widget',
    assistant_display_name: 'Helper',
    launcher_label: 'Ask us',
    launcher_icon: 'message',
    welcome_title: 'Welcome',
    welcome_subtitle: 'Plain text only.',
    theme_color_mode: 'dark',
    theme_accent: 'blue',
    theme_radius: 'md',
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
  } satisfies Updateable<DatabaseSchema['widgets']>;

  assert.equal(widgetInsert.public_key, 'widget-public-key');
  assert.equal('assistant_display_name' in widgetInsert, false);
  assert.equal(widgetSafeSettingsUpdate.theme_color_mode, 'dark');
  assert.equal(widgetSafeSettingsUpdate.theme_accent, 'blue');
});
