import type { Insertable, Selectable } from 'kysely';

import type { DatabaseClient, DatabaseExecutor, DatabaseSchema } from './db.ts';

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

export type ClaimPandaDeliveryIntentOptions = {
  now?: Date;
};

export type ClaimedPandaDeliveryIntent = {
  id: string;
  widgetId: string;
  conversationId: string;
  visitorSessionId: string;
  visitorMessageId: string;
  clientMessageId: string;
  routeHandleSnapshot: string;
  status: 'claimed';
  createdAt: Date;
  claimedAt: Date;
};

type ClaimedPandaDeliveryIntentRow = Pick<
  Selectable<DatabaseSchema['panda_delivery_intents']>,
  | 'id'
  | 'widget_id'
  | 'conversation_id'
  | 'visitor_session_id'
  | 'visitor_message_id'
  | 'client_message_id'
  | 'route_handle_snapshot'
  | 'status'
  | 'created_at'
  | 'claimed_at'
>;


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

export async function claimNextQueuedPandaDeliveryIntent(
  database: DatabaseClient,
  options: ClaimPandaDeliveryIntentOptions = {},
): Promise<ClaimedPandaDeliveryIntent | null> {
  const now = options.now ?? new Date();

  return database.transaction().execute(async (transaction) => {
    const selected = await transaction
      .selectFrom('panda_delivery_intents')
      .select('id')
      .where('status', '=', 'queued')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .forUpdate()
      .skipLocked()
      .limit(1)
      .executeTakeFirst();

    if (!selected) {
      return null;
    }

    const claimed = await transaction
      .updateTable('panda_delivery_intents')
      .set({ status: 'claimed', claimed_at: now, updated_at: now })
      .where('id', '=', selected.id)
      .where('status', '=', 'queued')
      .returning([
        'id',
        'widget_id',
        'conversation_id',
        'visitor_session_id',
        'visitor_message_id',
        'client_message_id',
        'route_handle_snapshot',
        'status',
        'created_at',
        'claimed_at',
      ])
      .executeTakeFirst();

    if (!claimed) {
      throw new Error(`Unable to claim selected Panda delivery intent ${selected.id}`);
    }

    return toClaimedPandaDeliveryIntent(claimed);
  });
}

function toClaimedPandaDeliveryIntent(row: ClaimedPandaDeliveryIntentRow): ClaimedPandaDeliveryIntent {
  if (row.status !== 'claimed') {
    throw new Error(`Claimed Panda delivery intent ${row.id} has status ${row.status}`);
  }

  if (!row.claimed_at) {
    throw new Error(`Claimed Panda delivery intent ${row.id} is missing claimed_at`);
  }

  return {
    id: row.id,
    widgetId: row.widget_id,
    conversationId: row.conversation_id,
    visitorSessionId: row.visitor_session_id,
    visitorMessageId: row.visitor_message_id,
    clientMessageId: row.client_message_id,
    routeHandleSnapshot: row.route_handle_snapshot,
    status: 'claimed',
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
  };
}

function normalizeRouteHandle(routeHandle: string | null | undefined): string | null {
  if (typeof routeHandle !== 'string') {
    return null;
  }

  const snapshot = routeHandle.trim();

  return snapshot ? snapshot : null;
}
