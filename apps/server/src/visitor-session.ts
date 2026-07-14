import type { FastifyInstance } from 'fastify';
import type { Insertable } from 'kysely';

import {
  parseVisitorKey,
  type VisitorSessionCreateRequest,
  type VisitorSessionCreateResponse,
} from '@panda-chat-widget/shared';
import type { DatabaseClient, DatabaseSchema } from './db.ts';
import { matchOriginToAllowedDomains } from './origin-domain.ts';
import {
  toRateLimitErrorResponse,
  type PublicWriteRateLimitHook,
  type RateLimitErrorResponse,
} from './rate-limit.ts';
import { readPublicWidgetKey, type InvalidWidgetRequestErrorResponse } from './request-validation.ts';
import { loadEnabledAllowedDomains } from './widget-bootstrap.ts';
import { findWidgetByPublicKey } from './widget-lookup.ts';

export type VisitorSessionRouteOptions = {
  database: DatabaseClient;
  publicWriteRateLimit: PublicWriteRateLimitHook;
};

export type VisitorSession = VisitorSessionCreateResponse['visitorSession'];

export type VisitorSessionErrorResponse =
  | InvalidWidgetRequestErrorResponse
  | RateLimitErrorResponse
  | {
      error: 'invalid_visitor_key';
      reason: 'not_string' | 'empty' | 'invalid_format';
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

type VisitorSessionRoute = {
  Params: {
    publicKey: string;
  };
  Body: unknown;
  Reply: VisitorSessionCreateResponse | VisitorSessionErrorResponse;
};

type VisitorSessionRequestBody = Partial<Record<keyof VisitorSessionCreateRequest, unknown>>;

type VisitorSessionRow = {
  id: string;
  visitor_key: string;
};

export function registerVisitorSessionRoutes(app: FastifyInstance, options: VisitorSessionRouteOptions): void {
  app.post<VisitorSessionRoute>('/api/widgets/:publicKey/visitor-session', async (request, reply) => {
    const publicKey = readPublicWidgetKey(request.params);

    if (publicKey.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_widget_request', reason: publicKey.reason });
    }

    const visitorKey = parseVisitorKey(readVisitorKey(request.body));

    if (visitorKey.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_visitor_key', reason: visitorKey.reason });
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

    const rateLimit = await options.publicWriteRateLimit({
      route: 'visitor_session_create',
      publicKey: widgetLookup.widget.publicKey,
      visitorKey: visitorKey.visitorKey,
    });

    if (!rateLimit.allowed) {
      return reply.status(429).send(toRateLimitErrorResponse(rateLimit));
    }

    const visitorSession = await getOrCreateVisitorSession(options.database, {
      widgetId: widgetLookup.widget.id,
      visitorKey: visitorKey.visitorKey,
    });

    return reply.send({ visitorSession });
  });
}

export type GetOrCreateVisitorSessionInput = {
  widgetId: string;
  visitorKey: string;
  now?: Date;
};

export async function getOrCreateVisitorSession(
  database: DatabaseClient,
  input: GetOrCreateVisitorSessionInput,
): Promise<VisitorSession> {
  const now = input.now ?? new Date();
  const values = {
    widget_id: input.widgetId,
    visitor_key: input.visitorKey,
    created_at: now,
    last_seen_at: now,
  } satisfies Insertable<DatabaseSchema['visitor_sessions']>;

  const row = (await database
    .insertInto('visitor_sessions')
    .values(values)
    .onConflict((oc) => oc.columns(['widget_id', 'visitor_key']).doUpdateSet({ last_seen_at: now }))
    .returning(['id', 'visitor_key'])
    .executeTakeFirstOrThrow()) as VisitorSessionRow;

  return {
    id: row.id,
    visitorKey: row.visitor_key,
  };
}

function readVisitorKey(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('visitorKey' in body)) {
    return undefined;
  }

  return (body as VisitorSessionRequestBody).visitorKey;
}
