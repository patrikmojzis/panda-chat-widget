import assert from 'node:assert/strict';
import test from 'node:test';

import type { MessageSender } from './db.ts';
import { createConversationMessageEventEmitter } from './message-events.ts';
import type { ConversationMessage } from './message.ts';

const FIRST_CREATED_AT = new Date('2026-01-01T00:00:00Z');

test('conversation message event emitter delivers messages to registered listeners in emit order', () => {
  const emitter = createConversationMessageEventEmitter();
  const received: Array<{ event: string; seq: number; body: string }> = [];

  emitter.subscribe('conversation-a', (event) => {
    received.push({ event: event.event, seq: event.message.seq, body: event.message.body });
  });

  emitter.emit(message({ id: 'message-1', conversationId: 'conversation-a', seq: 1, body: 'Visitor' }));
  emitter.emit(message({ id: 'message-2', conversationId: 'conversation-a', seq: 2, sender: 'agent', body: 'Reply' }));

  assert.deepEqual(received, [
    { event: 'message', seq: 1, body: 'Visitor' },
    { event: 'message', seq: 2, body: 'Reply' },
  ]);
});

test('conversation message event emitter unregisters listeners on subscription close', () => {
  const emitter = createConversationMessageEventEmitter();
  const received: string[] = [];
  const subscription = emitter.subscribe('conversation-a', (event) => {
    received.push(event.message.body);
  });

  emitter.emit(message({ id: 'message-1', conversationId: 'conversation-a', seq: 1, body: 'Before close' }));
  subscription.close();
  subscription.close();
  emitter.emit(message({ id: 'message-2', conversationId: 'conversation-a', seq: 2, body: 'After close' }));

  assert.deepEqual(received, ['Before close']);
});

test('conversation message event emitter does not leak messages across conversations', () => {
  const emitter = createConversationMessageEventEmitter();
  const conversationA: string[] = [];
  const conversationB: string[] = [];

  emitter.subscribe('conversation-a', (event) => {
    conversationA.push(event.message.body);
  });
  emitter.subscribe('conversation-b', (event) => {
    conversationB.push(event.message.body);
  });

  emitter.emit(message({ id: 'message-a', conversationId: 'conversation-a', seq: 1, body: 'A' }));
  emitter.emit(message({ id: 'message-b', conversationId: 'conversation-b', seq: 1, body: 'B' }));

  assert.deepEqual(conversationA, ['A']);
  assert.deepEqual(conversationB, ['B']);
});

type MessageInput = {
  id: string;
  conversationId: string;
  seq: number;
  sender?: MessageSender;
  clientMessageId?: string | null;
  body: string;
};

function message(input: MessageInput): ConversationMessage {
  return {
    id: input.id,
    conversationId: input.conversationId,
    seq: input.seq,
    sender: input.sender ?? 'visitor',
    clientMessageId: input.clientMessageId ?? null,
    body: input.body,
    createdAt: FIRST_CREATED_AT,
  };
}
