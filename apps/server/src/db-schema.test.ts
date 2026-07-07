import assert from 'node:assert/strict';
import test from 'node:test';

import type { Insertable, Updateable } from 'kysely';
import type { DatabaseSchema, PandaDeliveryIntentStatus } from './db.ts';

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
    'panda_delivery_intents',
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
    'panda_delivery_intents',
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


test('panda delivery intent inserts capture queued internal visitor delivery correlation', () => {
  type ExpectedPandaDeliveryIntentStatus = 'queued' | 'claimed';
  const statusIsExact: PandaDeliveryIntentStatus extends ExpectedPandaDeliveryIntentStatus
    ? ExpectedPandaDeliveryIntentStatus extends PandaDeliveryIntentStatus
      ? true
      : never
    : never = true;
  const statuses = ['queued', 'claimed'] satisfies PandaDeliveryIntentStatus[];
  const intentInsert = {
    widget_id: 'widget-id',
    conversation_id: 'conversation-id',
    visitor_session_id: 'visitor-session-id',
    visitor_message_id: 'message-id',
    client_message_id: 'client-message-id',
    route_handle_snapshot: 'panda:workspace/route',
    status: 'queued',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
  } satisfies Insertable<DatabaseSchema['panda_delivery_intents']>;
  const intentClaimUpdate = {
    status: 'claimed',
    claimed_at: new Date('2026-01-01T00:01:00.000Z'),
    updated_at: new Date('2026-01-01T00:01:00.000Z'),
  } satisfies Updateable<DatabaseSchema['panda_delivery_intents']>;

  assert.equal(statusIsExact, true);
  assert.deepEqual(statuses, ['queued', 'claimed']);
  assert.equal(intentInsert.status, 'queued');
  assert.equal('claimed_at' in intentInsert, false);
  assert.equal(intentClaimUpdate.status, 'claimed');
  assert.equal(intentClaimUpdate.claimed_at instanceof Date, true);
  assert.equal(intentInsert.widget_id, 'widget-id');
  assert.equal(intentInsert.conversation_id, 'conversation-id');
  assert.equal(intentInsert.visitor_session_id, 'visitor-session-id');
  assert.equal(intentInsert.visitor_message_id, 'message-id');
  assert.equal(intentInsert.client_message_id, 'client-message-id');
  assert.equal(intentInsert.route_handle_snapshot, 'panda:workspace/route');
});


test('widget inserts can rely on DB defaults while safe bootstrap and Panda connection settings are updateable', () => {
  const widgetInsert = {
    site_id: 'site-id',
    public_key: 'widget-public-key',
    name: 'Support Widget',
  } satisfies Insertable<DatabaseSchema['widgets']>;

  const widgetSafeSettingsUpdate = {
    name: 'Updated Widget',
    panda_route_handle: 'panda:workspace/route',
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

  const widgetConnectionClear = {
    panda_route_handle: null,
  } satisfies Updateable<DatabaseSchema['widgets']>;

  assert.equal(widgetInsert.public_key, 'widget-public-key');
  assert.equal('assistant_display_name' in widgetInsert, false);
  assert.equal('panda_route_handle' in widgetInsert, false);
  assert.equal(widgetSafeSettingsUpdate.panda_route_handle, 'panda:workspace/route');
  assert.equal(widgetConnectionClear.panda_route_handle, null);
  assert.equal(widgetSafeSettingsUpdate.theme_color_mode, 'dark');
  assert.equal(widgetSafeSettingsUpdate.theme_accent, 'blue');
});
