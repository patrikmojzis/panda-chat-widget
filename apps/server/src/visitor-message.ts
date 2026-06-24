import type { FastifyInstance } from 'fastify';

import {
  findVisitorSessionForWidget,
  type ConversationErrorResponse,
} from './conversation.ts';
import type { ConversationStatus, DatabaseClient } from './db.ts';
import { createFakeResponderReply } from './fake-responder.ts';
import type { ConversationMessageEventEmitter } from './message-events.ts';
import {
  insertConversationMessage,
  insertVisitorConversationMessage,
  readMessagesForConversation,
  type ConversationMessage,
} from './message.ts';
import { matchOriginToAllowedDomains } from './origin-domain.ts';
import { readPublicWidgetKey, type InvalidWidgetRequestErrorResponse } from './request-validation.ts';
import {
  serializeVisitorMessageEvents,
  shouldOpenLiveVisitorMessageEventStream,
  streamVisitorMessageEvents,
  VISITOR_MESSAGE_EVENT_STREAM_HEADERS,
} from './visitor-message-events.ts';
import { loadEnabledAllowedDomains } from './widget-bootstrap.ts';
import { findWidgetByPublicKey } from './widget-lookup.ts';

export type VisitorMessageRouteOptions = {
  database: DatabaseClient;
  messageEvents: ConversationMessageEventEmitter;
};

export type VisitorMessageCreateRequest = {
  visitorSessionId: string;
  conversationId: string;
  clientMessageId: string;
  body: string;
};

export type VisitorMessageCreateResponse = {
  message: ConversationMessage;
};

export type VisitorMessageListRequest = {
  visitorSessionId: string;
  conversationId: string;
  afterSeq?: number;
};

export type VisitorMessageListResponse = {
  messages: ConversationMessage[];
};

type InvalidVisitorMessageReason =
  | 'missing_visitor_session_id'
  | 'invalid_visitor_session_id'
  | 'missing_conversation_id'
  | 'invalid_conversation_id'
  | 'missing_client_message_id'
  | 'invalid_client_message_id'
  | 'missing_body'
  | 'invalid_body'
  | 'invalid_after_seq';

export type VisitorMessageErrorResponse =
  | InvalidWidgetRequestErrorResponse
  | {
      error: 'invalid_message_request';
      reason: InvalidVisitorMessageReason;
    }
  | {
      error: 'visitor_session_not_found';
    }
  | {
      error: 'conversation_not_found';
    }
  | {
      error: 'conversation_closed';
    }
  | ConversationErrorResponse;

type VisitorMessageCreateRoute = {
  Params: {
    publicKey: string;
  };
  Body: unknown;
  Reply: VisitorMessageCreateResponse | VisitorMessageErrorResponse;
};

type VisitorMessageListRoute = {
  Params: {
    publicKey: string;
  };
  Querystring: unknown;
  Reply: VisitorMessageListResponse | VisitorMessageErrorResponse;
};

type VisitorMessageEventsRoute = {
  Params: {
    publicKey: string;
  };
  Querystring: unknown;
  Reply: string | VisitorMessageErrorResponse;
};

type VisitorMessageRequestValues = Partial<Record<keyof VisitorMessageCreateRequest | 'afterSeq', unknown>>;

type ConversationOwnershipRow = {
  id: string;
  status: ConversationStatus;
};

type ConversationOwnershipResult =
  | {
      status: 'open';
      conversationId: string;
    }
  | {
      status: 'closed';
    }
  | {
      status: 'not_found';
    };

export function registerVisitorMessageRoutes(app: FastifyInstance, options: VisitorMessageRouteOptions): void {
  app.post<VisitorMessageCreateRoute>('/api/widgets/:publicKey/messages', async (request, reply) => {
    const publicKey = readPublicWidgetKey(request.params);

    if (publicKey.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_widget_request', reason: publicKey.reason });
    }

    const messageRequest = parseVisitorMessageRequest(request.body);

    if (messageRequest.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_message_request', reason: messageRequest.reason });
    }

    const widgetLookup = await findWidgetByPublicKey(options.database, publicKey.publicKey);

    if (widgetLookup.status === 'not_found') {
      return reply.status(404).send({ error: 'widget_not_found' });
    }

    if (widgetLookup.status === 'disabled') {
      return reply.status(403).send({ error: 'widget_disabled', reason: widgetLookup.reason });
    }

    const allowedDomains = await loadEnabledAllowedDomains(options.database, widgetLookup.widget.id);
    const originMatch = matchOriginToAllowedDomains(request.headers.origin, allowedDomains);

    if (!originMatch.allowed) {
      return reply.status(403).send({ error: 'origin_not_allowed', reason: originMatch.reason });
    }

    const visitorSession = await findVisitorSessionForWidget(options.database, {
      widgetId: widgetLookup.widget.id,
      visitorSessionId: messageRequest.request.visitorSessionId,
    });

    if (!visitorSession) {
      return reply.status(404).send({ error: 'visitor_session_not_found' });
    }

    const conversation = await findConversationForVisitorMessage(options.database, {
      widgetId: widgetLookup.widget.id,
      visitorSessionId: visitorSession.visitorSessionId,
      conversationId: messageRequest.request.conversationId,
    });

    if (conversation.status === 'not_found') {
      return reply.status(404).send({ error: 'conversation_not_found' });
    }

    if (conversation.status === 'closed') {
      return reply.status(409).send({ error: 'conversation_closed' });
    }

    const messageResult = await insertVisitorConversationMessage(options.database, {
      conversationId: conversation.conversationId,
      sender: 'visitor',
      clientMessageId: messageRequest.request.clientMessageId,
      body: messageRequest.request.body,
    });

    if (messageResult.inserted) {
      const fakeReply = createFakeResponderReply({ visitorMessage: { body: messageResult.message.body } });
      const fakeReplyMessage = await insertConversationMessage(options.database, {
        conversationId: conversation.conversationId,
        sender: 'agent',
        body: fakeReply.body,
      });

      options.messageEvents.emit(messageResult.message);
      options.messageEvents.emit(fakeReplyMessage);
    }

    return reply.send({ message: messageResult.message });
  });

  app.get<VisitorMessageListRoute>('/api/widgets/:publicKey/messages', async (request, reply) => {
    const publicKey = readPublicWidgetKey(request.params);

    if (publicKey.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_widget_request', reason: publicKey.reason });
    }

    const messageRequest = parseVisitorMessageListQuery(request.query);

    if (messageRequest.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_message_request', reason: messageRequest.reason });
    }

    const widgetLookup = await findWidgetByPublicKey(options.database, publicKey.publicKey);

    if (widgetLookup.status === 'not_found') {
      return reply.status(404).send({ error: 'widget_not_found' });
    }

    if (widgetLookup.status === 'disabled') {
      return reply.status(403).send({ error: 'widget_disabled', reason: widgetLookup.reason });
    }

    const allowedDomains = await loadEnabledAllowedDomains(options.database, widgetLookup.widget.id);
    const originMatch = matchOriginToAllowedDomains(request.headers.origin, allowedDomains);

    if (!originMatch.allowed) {
      return reply.status(403).send({ error: 'origin_not_allowed', reason: originMatch.reason });
    }

    const visitorSession = await findVisitorSessionForWidget(options.database, {
      widgetId: widgetLookup.widget.id,
      visitorSessionId: messageRequest.request.visitorSessionId,
    });

    if (!visitorSession) {
      return reply.status(404).send({ error: 'visitor_session_not_found' });
    }

    const conversation = await findConversationForVisitorMessage(options.database, {
      widgetId: widgetLookup.widget.id,
      visitorSessionId: visitorSession.visitorSessionId,
      conversationId: messageRequest.request.conversationId,
    });

    if (conversation.status === 'not_found') {
      return reply.status(404).send({ error: 'conversation_not_found' });
    }

    if (conversation.status === 'closed') {
      return reply.status(409).send({ error: 'conversation_closed' });
    }

    const readOptions =
      messageRequest.request.afterSeq === undefined ? {} : { afterSeq: messageRequest.request.afterSeq };
    const messages = await readMessagesForConversation(options.database, conversation.conversationId, readOptions);

    return reply.send({ messages });
  });

  app.get<VisitorMessageEventsRoute>('/api/widgets/:publicKey/messages/events', async (request, reply) => {
    const publicKey = readPublicWidgetKey(request.params);

    if (publicKey.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_widget_request', reason: publicKey.reason });
    }

    const messageRequest = parseVisitorMessageListQuery(request.query);

    if (messageRequest.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_message_request', reason: messageRequest.reason });
    }

    const widgetLookup = await findWidgetByPublicKey(options.database, publicKey.publicKey);

    if (widgetLookup.status === 'not_found') {
      return reply.status(404).send({ error: 'widget_not_found' });
    }

    if (widgetLookup.status === 'disabled') {
      return reply.status(403).send({ error: 'widget_disabled', reason: widgetLookup.reason });
    }

    const allowedDomains = await loadEnabledAllowedDomains(options.database, widgetLookup.widget.id);
    const originMatch = matchOriginToAllowedDomains(request.headers.origin, allowedDomains);

    if (!originMatch.allowed) {
      return reply.status(403).send({ error: 'origin_not_allowed', reason: originMatch.reason });
    }

    const visitorSession = await findVisitorSessionForWidget(options.database, {
      widgetId: widgetLookup.widget.id,
      visitorSessionId: messageRequest.request.visitorSessionId,
    });

    if (!visitorSession) {
      return reply.status(404).send({ error: 'visitor_session_not_found' });
    }

    const conversation = await findConversationForVisitorMessage(options.database, {
      widgetId: widgetLookup.widget.id,
      visitorSessionId: visitorSession.visitorSessionId,
      conversationId: messageRequest.request.conversationId,
    });

    if (conversation.status === 'not_found') {
      return reply.status(404).send({ error: 'conversation_not_found' });
    }

    if (conversation.status === 'closed') {
      return reply.status(409).send({ error: 'conversation_closed' });
    }

    const readOptions =
      messageRequest.request.afterSeq === undefined ? {} : { afterSeq: messageRequest.request.afterSeq };
    const messages = await readMessagesForConversation(options.database, conversation.conversationId, readOptions);

    if (shouldOpenLiveVisitorMessageEventStream(request.headers.accept)) {
      reply.hijack();
      reply.raw.writeHead(200, VISITOR_MESSAGE_EVENT_STREAM_HEADERS);
      streamVisitorMessageEvents({
        conversationId: conversation.conversationId,
        initialMessages: messages,
        messageEvents: options.messageEvents,
        response: reply.raw,
        request: request.raw,
      });

      return;
    }

    return reply
      .header('content-type', VISITOR_MESSAGE_EVENT_STREAM_HEADERS['content-type'])
      .header('cache-control', VISITOR_MESSAGE_EVENT_STREAM_HEADERS['cache-control'])
      .header('connection', VISITOR_MESSAGE_EVENT_STREAM_HEADERS.connection)
      .send(serializeVisitorMessageEvents(messages));
  });
}

export type FindConversationForVisitorMessageInput = {
  widgetId: string;
  visitorSessionId: string;
  conversationId: string;
};

export async function findConversationForVisitorMessage(
  database: DatabaseClient,
  input: FindConversationForVisitorMessageInput,
): Promise<ConversationOwnershipResult> {
  const row = (await database
    .selectFrom('conversations')
    .select(['id', 'status'])
    .where('id', '=', input.conversationId)
    .where('widget_id', '=', input.widgetId)
    .where('visitor_session_id', '=', input.visitorSessionId)
    .executeTakeFirst()) as ConversationOwnershipRow | undefined;

  if (!row) {
    return { status: 'not_found' };
  }

  if (row.status !== 'open') {
    return { status: 'closed' };
  }

  return { status: 'open', conversationId: row.id };
}

type VisitorMessageParseResult =
  | {
      status: 'valid';
      request: VisitorMessageCreateRequest;
    }
  | {
      status: 'invalid';
      reason: InvalidVisitorMessageReason;
    };

function parseVisitorMessageRequest(body: unknown): VisitorMessageParseResult {
  if (typeof body !== 'object' || body === null) {
    return { status: 'invalid', reason: 'missing_visitor_session_id' };
  }

  const requestBody = body as VisitorMessageRequestValues;
  const visitorSessionId = readRequiredString(requestBody, 'visitorSessionId', {
    missing: 'missing_visitor_session_id',
    invalid: 'invalid_visitor_session_id',
  });

  if (visitorSessionId.status === 'invalid') {
    return visitorSessionId;
  }

  const conversationId = readRequiredString(requestBody, 'conversationId', {
    missing: 'missing_conversation_id',
    invalid: 'invalid_conversation_id',
  });

  if (conversationId.status === 'invalid') {
    return conversationId;
  }

  const clientMessageId = readRequiredString(requestBody, 'clientMessageId', {
    missing: 'missing_client_message_id',
    invalid: 'invalid_client_message_id',
  });

  if (clientMessageId.status === 'invalid') {
    return clientMessageId;
  }

  const messageBody = readRequiredString(requestBody, 'body', {
    missing: 'missing_body',
    invalid: 'invalid_body',
  });

  if (messageBody.status === 'invalid') {
    return messageBody;
  }

  return {
    status: 'valid',
    request: {
      visitorSessionId: visitorSessionId.value,
      conversationId: conversationId.value,
      clientMessageId: clientMessageId.value,
      body: messageBody.value,
    },
  };
}


type VisitorMessageListParseResult =
  | {
      status: 'valid';
      request: VisitorMessageListRequest;
    }
  | {
      status: 'invalid';
      reason: InvalidVisitorMessageReason;
    };

function parseVisitorMessageListQuery(query: unknown): VisitorMessageListParseResult {
  if (typeof query !== 'object' || query === null) {
    return { status: 'invalid', reason: 'missing_visitor_session_id' };
  }

  const requestQuery = query as VisitorMessageRequestValues;
  const visitorSessionId = readRequiredString(requestQuery, 'visitorSessionId', {
    missing: 'missing_visitor_session_id',
    invalid: 'invalid_visitor_session_id',
  });

  if (visitorSessionId.status === 'invalid') {
    return visitorSessionId;
  }

  const conversationId = readRequiredString(requestQuery, 'conversationId', {
    missing: 'missing_conversation_id',
    invalid: 'invalid_conversation_id',
  });

  if (conversationId.status === 'invalid') {
    return conversationId;
  }

  const afterSeq = readOptionalAfterSeq(requestQuery);

  if (afterSeq.status === 'invalid') {
    return afterSeq;
  }

  const request: VisitorMessageListRequest = {
    visitorSessionId: visitorSessionId.value,
    conversationId: conversationId.value,
  };

  if (afterSeq.value !== undefined) {
    request.afterSeq = afterSeq.value;
  }

  return { status: 'valid', request };
}

type RequiredStringError = InvalidVisitorMessageReason;

type RequiredStringResult =
  | {
      status: 'valid';
      value: string;
    }
  | {
      status: 'invalid';
      reason: RequiredStringError;
    };

function readRequiredString(
  body: VisitorMessageRequestValues,
  key: keyof VisitorMessageCreateRequest,
  reasons: { missing: RequiredStringError; invalid: RequiredStringError },
): RequiredStringResult {
  if (!(key in body)) {
    return { status: 'invalid', reason: reasons.missing };
  }

  const value = body[key];

  if (typeof value !== 'string') {
    return { status: 'invalid', reason: reasons.invalid };
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return { status: 'invalid', reason: reasons.missing };
  }

  return { status: 'valid', value: trimmedValue };
}

type OptionalAfterSeqResult =
  | {
      status: 'valid';
      value?: number;
    }
  | {
      status: 'invalid';
      reason: 'invalid_after_seq';
    };

function readOptionalAfterSeq(query: VisitorMessageRequestValues): OptionalAfterSeqResult {
  if (!('afterSeq' in query)) {
    return { status: 'valid' };
  }

  const value = query.afterSeq;

  if (typeof value !== 'string') {
    return { status: 'invalid', reason: 'invalid_after_seq' };
  }

  const trimmedValue = value.trim();

  if (!/^\d+$/.test(trimmedValue)) {
    return { status: 'invalid', reason: 'invalid_after_seq' };
  }

  const afterSeq = Number(trimmedValue);

  if (!Number.isSafeInteger(afterSeq)) {
    return { status: 'invalid', reason: 'invalid_after_seq' };
  }

  return { status: 'valid', value: afterSeq };
}
