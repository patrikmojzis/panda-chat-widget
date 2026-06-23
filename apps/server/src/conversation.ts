import type { FastifyInstance } from 'fastify';
import type { Insertable } from 'kysely';

import type { VisitorSessionReference } from '../../../packages/shared/src/visitor-identity.ts';
import type { ConversationStatus, DatabaseClient, DatabaseSchema } from './db.ts';
import { matchOriginToAllowedDomains } from './origin-domain.ts';
import { loadEnabledAllowedDomains } from './widget-bootstrap.ts';
import { findWidgetByPublicKey } from './widget-lookup.ts';

export type ConversationRouteOptions = {
  database: DatabaseClient;
};

export type ActiveConversation = {
  id: string;
  visitorSessionId: string;
  status: 'open';
};

export type ConversationCreateResponse = {
  conversation: ActiveConversation;
};

export type ConversationErrorResponse =
  | {
      error: 'invalid_visitor_session';
      reason: 'missing_visitor_session_id' | 'invalid_visitor_session_id';
    }
  | {
      error: 'visitor_session_not_found';
    }
  | {
      error: 'widget_not_found';
    }
  | {
      error: 'widget_disabled';
      reason: 'widget_disabled' | 'site_disabled';
    }
  | {
      error: 'origin_not_allowed';
      reason: 'missing_origin' | 'invalid_origin' | 'domain_not_allowed';
    };

type ConversationRoute = {
  Params: {
    publicKey: string;
  };
  Body: unknown;
  Reply: ConversationCreateResponse | ConversationErrorResponse;
};

type ConversationRequestBody = Partial<Record<keyof VisitorSessionReference, unknown>>;

type ConversationRow = {
  id: string;
  visitor_session_id: string | null;
  status: ConversationStatus;
};

type VisitorSessionRow = {
  id: string;
};

export function registerConversationRoutes(app: FastifyInstance, options: ConversationRouteOptions): void {
  app.post<ConversationRoute>('/api/widgets/:publicKey/conversations', async (request, reply) => {
    const visitorSessionId = readVisitorSessionId(request.body);

    if (visitorSessionId.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_visitor_session', reason: visitorSessionId.reason });
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
      visitorSessionId: visitorSessionId.visitorSessionId,
    });

    if (!visitorSession) {
      return reply.status(404).send({ error: 'visitor_session_not_found' });
    }

    const conversation = await getOrCreateDefaultConversation(options.database, {
      widgetId: widgetLookup.widget.id,
      visitorSessionId: visitorSession.visitorSessionId,
    });

    return reply.send({ conversation });
  });
}

export type FindVisitorSessionForWidgetInput = {
  widgetId: string;
  visitorSessionId: string;
};

export async function findVisitorSessionForWidget(
  database: DatabaseClient,
  input: FindVisitorSessionForWidgetInput,
): Promise<VisitorSessionReference | null> {
  const row = (await database
    .selectFrom('visitor_sessions')
    .select('id')
    .where('id', '=', input.visitorSessionId)
    .where('widget_id', '=', input.widgetId)
    .executeTakeFirst()) as VisitorSessionRow | undefined;

  if (!row) {
    return null;
  }

  return { visitorSessionId: row.id };
}

export type GetOrCreateDefaultConversationInput = {
  widgetId: string;
  visitorSessionId: string;
  now?: Date;
};

export async function getOrCreateDefaultConversation(
  database: DatabaseClient,
  input: GetOrCreateDefaultConversationInput,
): Promise<ActiveConversation> {
  const existingConversation = (await database
    .selectFrom('conversations')
    .select(['id', 'visitor_session_id', 'status'])
    .where('widget_id', '=', input.widgetId)
    .where('visitor_session_id', '=', input.visitorSessionId)
    .where('status', '=', 'open')
    .orderBy('created_at', 'asc')
    .executeTakeFirst()) as ConversationRow | undefined;

  if (existingConversation) {
    return toActiveConversation(existingConversation, input.visitorSessionId);
  }

  const now = input.now ?? new Date();
  const values = {
    widget_id: input.widgetId,
    visitor_session_id: input.visitorSessionId,
    status: 'open',
    created_at: now,
    updated_at: now,
  } satisfies Insertable<DatabaseSchema['conversations']>;

  const newConversation = (await database
    .insertInto('conversations')
    .values(values)
    .returning(['id', 'visitor_session_id', 'status'])
    .executeTakeFirstOrThrow()) as ConversationRow;

  return toActiveConversation(newConversation, input.visitorSessionId);
}

type VisitorSessionIdReadResult =
  | {
      status: 'valid';
      visitorSessionId: string;
    }
  | {
      status: 'invalid';
      reason: 'missing_visitor_session_id' | 'invalid_visitor_session_id';
    };

function readVisitorSessionId(body: unknown): VisitorSessionIdReadResult {
  if (typeof body !== 'object' || body === null || !('visitorSessionId' in body)) {
    return { status: 'invalid', reason: 'missing_visitor_session_id' };
  }

  const value = (body as ConversationRequestBody).visitorSessionId;

  if (typeof value !== 'string') {
    return { status: 'invalid', reason: 'invalid_visitor_session_id' };
  }

  const visitorSessionId = value.trim();

  if (!visitorSessionId) {
    return { status: 'invalid', reason: 'missing_visitor_session_id' };
  }

  return { status: 'valid', visitorSessionId };
}

function toActiveConversation(row: ConversationRow, visitorSessionId: string): ActiveConversation {
  return {
    id: row.id,
    visitorSessionId,
    status: 'open',
  };
}
