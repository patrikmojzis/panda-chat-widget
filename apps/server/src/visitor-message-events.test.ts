import assert from 'node:assert/strict';
import test from 'node:test';

import type { MessageSender } from './db.ts';
import { createConversationMessageEventEmitter } from './message-events.ts';
import type { ConversationMessage } from './message.ts';
import {
  serializeVisitorMessageEvents,
  shouldOpenLiveVisitorMessageEventStream,
  streamVisitorMessageEvents,
  type VisitorMessageEventStreamRequest,
} from './visitor-message-events.ts';

const FIRST_CREATED_AT = new Date('2026-01-01T00:00:00Z');

test('streamVisitorMessageEvents writes catch-up before live events and cleans up on close', () => {
  const messageEvents = createConversationMessageEventEmitter();
  const chunks: string[] = [];
  const request = createFakeStreamRequest();

  streamVisitorMessageEvents({
    conversationId: 'conversation-a',
    initialMessages: [message({ id: 'message-1', conversationId: 'conversation-a', seq: 1, body: 'Catch-up' })],
    messageEvents,
    response: {
      write: (chunk) => chunks.push(chunk),
    },
    request,
  });

  messageEvents.emit(message({ id: 'message-2', conversationId: 'conversation-a', seq: 2, sender: 'agent', body: 'Live' }));
  messageEvents.emit(message({ id: 'message-other', conversationId: 'conversation-b', seq: 3, body: 'Other conversation' }));
  request.emit('close');
  messageEvents.emit(message({ id: 'message-3', conversationId: 'conversation-a', seq: 4, body: 'After close' }));

  assert.deepEqual(
    parseServerSentEvents(chunks.join('')).map((event) => {
      const data = event.data as { message: { seq: number; body: string } };

      return { event: event.event, seq: data.message.seq, body: data.message.body };
    }),
    [
      { event: 'message', seq: 1, body: 'Catch-up' },
      { event: 'message', seq: 2, body: 'Live' },
    ],
  );
  assert.doesNotMatch(chunks.join(''), /Other conversation|After close/);
});

test('serializeVisitorMessageEvents emits a ready event when no catch-up messages exist', () => {
  assert.deepEqual(parseServerSentEvents(serializeVisitorMessageEvents([])), [{ event: 'ready', data: {} }]);
});

test('shouldOpenLiveVisitorMessageEventStream recognizes EventSource accept headers only', () => {
  assert.equal(shouldOpenLiveVisitorMessageEventStream('text/event-stream'), true);
  assert.equal(shouldOpenLiveVisitorMessageEventStream('text/html, text/event-stream;q=0.9'), true);
  assert.equal(shouldOpenLiveVisitorMessageEventStream(['application/json', 'text/event-stream']), true);
  assert.equal(shouldOpenLiveVisitorMessageEventStream(undefined), false);
  assert.equal(shouldOpenLiveVisitorMessageEventStream('application/json'), false);
});

type FakeStreamRequest = VisitorMessageEventStreamRequest & {
  emit: (event: 'aborted' | 'close') => void;
};

function createFakeStreamRequest(): FakeStreamRequest {
  const listeners: Partial<Record<'aborted' | 'close', Array<() => void>>> = {};

  return {
    on: (event, listener) => {
      listeners[event] = [...(listeners[event] ?? []), listener];
    },
    emit: (event) => {
      for (const listener of listeners[event] ?? []) {
        listener();
      }
    },
  };
}

type ParsedServerSentEvent = {
  event: string;
  data: unknown;
};

function parseServerSentEvents(body: string): ParsedServerSentEvent[] {
  return body
    .trim()
    .split('\n\n')
    .filter((block) => block.length > 0)
    .map((block) => {
      const [eventLine, dataLine] = block.split('\n');

      if (eventLine === undefined || dataLine === undefined) {
        throw new Error('invalid SSE event block');
      }

      assert.match(eventLine, /^event: /);
      assert.match(dataLine, /^data: /);

      return {
        event: eventLine.slice('event: '.length),
        data: JSON.parse(dataLine.slice('data: '.length)),
      };
    });
}

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
