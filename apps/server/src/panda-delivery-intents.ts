import type { Insertable } from 'kysely';

import type { DatabaseExecutor, DatabaseSchema } from './db.ts';

export type RecordPandaDeliveryIntentInput = {
  widgetId: string;
  conversationId: string;
  visitorSessionId: string;
  visitorMessageId: string;
  clientMessageId: string;
  routeHandle: string | null | undefined;
  now?: Date;
};

export type RecordPandaDeliveryIntentResult =
  | {
      recorded: true;
    }
  | {
      recorded: false;
      reason: 'missing_route_handle' | 'already_recorded';
    };

export async function recordPandaDeliveryIntent(
  database: DatabaseExecutor,
  input: RecordPandaDeliveryIntentInput,
): Promise<RecordPandaDeliveryIntentResult> {
  const routeHandleSnapshot = normalizeRouteHandle(input.routeHandle);

  if (!routeHandleSnapshot) {
    return { recorded: false, reason: 'missing_route_handle' };
  }

  const now = input.now ?? new Date();
  const values = {
    widget_id: input.widgetId,
    conversation_id: input.conversationId,
    visitor_session_id: input.visitorSessionId,
    visitor_message_id: input.visitorMessageId,
    client_message_id: input.clientMessageId,
    route_handle_snapshot: routeHandleSnapshot,
    status: 'queued',
    created_at: now,
    updated_at: now,
  } satisfies Insertable<DatabaseSchema['panda_delivery_intents']>;

  const row = await database
    .insertInto('panda_delivery_intents')
    .values(values)
    .onConflict((oc) => oc.column('visitor_message_id').doNothing())
    .returning('id')
    .executeTakeFirst();

  return row ? { recorded: true } : { recorded: false, reason: 'already_recorded' };
}

function normalizeRouteHandle(routeHandle: string | null | undefined): string | null {
  if (typeof routeHandle !== 'string') {
    return null;
  }

  const snapshot = routeHandle.trim();

  return snapshot ? snapshot : null;
}
