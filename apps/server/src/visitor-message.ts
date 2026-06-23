import type { FastifyInstance } from 'fastify';

import {
  findVisitorSessionForWidget,
  type ConversationErrorResponse,
} from './conversation.ts';
import type { ConversationStatus, DatabaseClient } from './db.ts';
import { insertConversationMessage, type ConversationMessage } from './message.ts';
import { matchOriginToAllowedDomains } from './origin-domain.ts';
import { loadEnabledAllowedDomains } from './widget-bootstrap.ts';
import { findWidgetByPublicKey } from './widget-lookup.ts';

export type VisitorMessageRouteOptions = {
  database: DatabaseClient;
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

type InvalidVisitorMessageReason =
  | 'missing_visitor_session_id'
  | 'invalid_visitor_session_id'
  | 'missing_conversation_id'
  | 'invalid_conversation_id'
  | 'missing_client_message_id'
  | 'invalid_client_message_id'
  | 'missing_body'
  | 'invalid_body';

export type VisitorMessageErrorResponse =
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

type VisitorMessageRoute = {
  Params: {
    publicKey: string;
  };
  Body: unknown;
  Reply: VisitorMessageCreateResponse | VisitorMessageErrorResponse;
};

type VisitorMessageRequestBody = Partial<Record<keyof VisitorMessageCreateRequest, unknown>>;

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
  app.post<VisitorMessageRoute>('/api/widgets/:publicKey/messages', async (request, reply) => {
    const messageRequest = parseVisitorMessageRequest(request.body);

    if (messageRequest.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_message_request', reason: messageRequest.reason });
    }

    const widgetLookup = await findWidgetByPublicKey(options.database, request.params.publicKey);

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

    const message = await insertConversationMessage(options.database, {
      conversationId: conversation.conversationId,
      sender: 'visitor',
      clientMessageId: messageRequest.request.clientMessageId,
      body: messageRequest.request.body,
    });

    return reply.send({ message });
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

  const requestBody = body as VisitorMessageRequestBody;
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
  body: VisitorMessageRequestBody,
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
