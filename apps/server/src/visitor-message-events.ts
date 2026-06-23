import type { ConversationMessageEventEmitter, ConversationMessageEventSubscription } from './message-events.ts';
import type { ConversationMessage } from './message.ts';

export const VISITOR_MESSAGE_EVENT_STREAM_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
} as const;

type ServerSentEventInput = {
  event: string;
  data: unknown;
};

export type VisitorMessageEventStreamResponse = {
  write: (chunk: string) => unknown;
};

export type VisitorMessageEventStreamRequest = {
  on: (event: 'aborted' | 'close', listener: () => void) => unknown;
};

export type StreamVisitorMessageEventsInput = {
  conversationId: string;
  initialMessages: ConversationMessage[];
  messageEvents: ConversationMessageEventEmitter;
  response: VisitorMessageEventStreamResponse;
  request: VisitorMessageEventStreamRequest;
};

export function shouldOpenLiveVisitorMessageEventStream(acceptHeader: string | string[] | undefined): boolean {
  const headerValue = Array.isArray(acceptHeader) ? acceptHeader.join(',') : (acceptHeader ?? '');

  return headerValue.toLowerCase().includes('text/event-stream');
}

export function streamVisitorMessageEvents(input: StreamVisitorMessageEventsInput): ConversationMessageEventSubscription {
  input.response.write(serializeVisitorMessageEvents(input.initialMessages));

  const subscription = input.messageEvents.subscribe(input.conversationId, (event) => {
    input.response.write(serializeServerSentEvent({ event: event.event, data: { message: event.message } }));
  });
  let closed = false;

  const close = () => {
    if (closed) {
      return;
    }

    closed = true;
    subscription.close();
  };

  input.request.on('aborted', close);
  input.request.on('close', close);

  return { close };
}

export function serializeVisitorMessageEvents(messages: ConversationMessage[]): string {
  if (messages.length === 0) {
    return serializeServerSentEvent({ event: 'ready', data: {} });
  }

  return messages
    .map((message) => serializeServerSentEvent({ event: 'message', data: { message } }))
    .join('');
}

function serializeServerSentEvent(input: ServerSentEventInput): string {
  return `event: ${input.event}\ndata: ${JSON.stringify(input.data)}\n\n`;
}
