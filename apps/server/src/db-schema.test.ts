import assert from 'node:assert/strict';
import test from 'node:test';

import type { Insertable } from 'kysely';
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
