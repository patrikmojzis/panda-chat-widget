import { sql, type Selectable } from 'kysely';

import type { DatabaseClient, DatabaseSchema, PandaDeliveryIntentStatus } from './db.ts';

export type LocalPandaDeliveryStatusMetadata = {
  locality: 'local-only';
  input: 'no-stdin';
  arguments: 'no-arguments';
  readOnly: 'read-only';
  databaseAccess: 'select-only';
  network: 'no-network';
  pandaCall: 'not-attempted';
  gatewayCall: 'not-attempted';
  externalCliCall: 'not-attempted';
  childProcess: 'not-used';
  publicRoute: 'not-created';
  worker: 'not-created';
  schema: 'not-created-or-migrated';
  frontendExposure: 'not-created';
  stateMutation: 'no-state-mutation';
  statusLifecycleExpansion: 'not-attempted';
};

export type LocalPandaDeliveryStatusIntentSummary = {
  id: string;
  widgetId: string;
  conversationId: string;
  visitorSessionId: string;
  visitorMessageId: string;
  clientMessageId: string;
  routeHandleSnapshot: string;
  status: PandaDeliveryIntentStatus;
  createdAt: string;
  claimedAt: string | null;
};

export type LocalPandaDeliveryStatusResult = {
  kind: 'local-panda-delivery-status';
  mode: 'local-only-read-only-diagnostics';
  metadata: LocalPandaDeliveryStatusMetadata;
  queuedIntentCount: number;
  oldestQueuedIntent: LocalPandaDeliveryStatusIntentSummary | null;
  claimedIntentCount: number;
  claimedUnappliedIntentCount: number;
  oldestClaimedUnappliedIntent: LocalPandaDeliveryStatusIntentSummary | null;
  appliedLocalReplyCount: number;
  nextLocalReplyCandidate: LocalPandaDeliveryStatusIntentSummary | null;
};

type LocalPandaDeliveryStatusIntentSummaryRow = Pick<
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

type LocalPandaDeliveryAggregateCount = string | number | bigint | null | undefined;

type LocalPandaDeliveryQueuedAndClaimedCountRow = {
  queued_intent_count: LocalPandaDeliveryAggregateCount;
  claimed_intent_count: LocalPandaDeliveryAggregateCount;
};

type LocalPandaDeliveryClaimedUnappliedCountRow = {
  claimed_unapplied_intent_count: LocalPandaDeliveryAggregateCount;
};

type LocalPandaDeliveryAppliedReplyCountRow = {
  applied_local_reply_count: LocalPandaDeliveryAggregateCount;
};

const DELIVERY_STATUS_KIND = 'local-panda-delivery-status';
const DELIVERY_STATUS_MODE = 'local-only-read-only-diagnostics';
const DELIVERY_STATUS_METADATA: LocalPandaDeliveryStatusMetadata = {
  locality: 'local-only',
  input: 'no-stdin',
  arguments: 'no-arguments',
  readOnly: 'read-only',
  databaseAccess: 'select-only',
  network: 'no-network',
  pandaCall: 'not-attempted',
  gatewayCall: 'not-attempted',
  externalCliCall: 'not-attempted',
  childProcess: 'not-used',
  publicRoute: 'not-created',
  worker: 'not-created',
  schema: 'not-created-or-migrated',
  frontendExposure: 'not-created',
  stateMutation: 'no-state-mutation',
  statusLifecycleExpansion: 'not-attempted',
};

export async function readLocalPandaDeliveryStatus(
  database: DatabaseClient,
): Promise<LocalPandaDeliveryStatusResult> {
  const queuedAndClaimedCounts = await readQueuedAndClaimedIntentCounts(database);
  const oldestQueuedIntent = await readOldestQueuedIntent(database);
  const claimedUnappliedIntentCount = await readClaimedUnappliedIntentCount(database);
  const oldestClaimedUnappliedIntent = await readOldestClaimedUnappliedIntent(database);
  const appliedLocalReplyCount = await readAppliedLocalReplyCount(database);

  return {
    kind: DELIVERY_STATUS_KIND,
    mode: DELIVERY_STATUS_MODE,
    metadata: { ...DELIVERY_STATUS_METADATA },
    queuedIntentCount: queuedAndClaimedCounts.queuedIntentCount,
    oldestQueuedIntent,
    claimedIntentCount: queuedAndClaimedCounts.claimedIntentCount,
    claimedUnappliedIntentCount,
    oldestClaimedUnappliedIntent,
    appliedLocalReplyCount,
    nextLocalReplyCandidate: oldestClaimedUnappliedIntent ?? oldestQueuedIntent,
  };
}

async function readQueuedAndClaimedIntentCounts(
  database: DatabaseClient,
): Promise<Pick<LocalPandaDeliveryStatusResult, 'queuedIntentCount' | 'claimedIntentCount'>> {
  const row = (await database
    .selectFrom('panda_delivery_intents')
    .select((eb) => [
      eb.fn.count<string | number | bigint>('id').filterWhere('status', '=', 'queued').as('queued_intent_count'),
      eb.fn.count<string | number | bigint>('id').filterWhere('status', '=', 'claimed').as('claimed_intent_count'),
    ])
    .executeTakeFirst()) as LocalPandaDeliveryQueuedAndClaimedCountRow | undefined;

  return {
    queuedIntentCount: toCountNumber(row?.queued_intent_count),
    claimedIntentCount: toCountNumber(row?.claimed_intent_count),
  };
}

async function readOldestQueuedIntent(
  database: DatabaseClient,
): Promise<LocalPandaDeliveryStatusIntentSummary | null> {
  const row = (await database
    .selectFrom('panda_delivery_intents')
    .select([
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
    .where('status', '=', 'queued')
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .limit(1)
    .executeTakeFirst()) as LocalPandaDeliveryStatusIntentSummaryRow | undefined;

  return row ? toIntentSummary(row) : null;
}

async function readClaimedUnappliedIntentCount(database: DatabaseClient): Promise<number> {
  const row = (await database
    .selectFrom('panda_delivery_intents')
    .select((eb) => [eb.fn.count<string | number | bigint>('id').as('claimed_unapplied_intent_count')])
    .where('status', '=', 'claimed')
    .where('claimed_at', 'is not', null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('messages')
            .select('messages.id')
            .whereRef('messages.conversation_id', '=', 'panda_delivery_intents.conversation_id')
            .where('messages.sender', '=', 'agent')
            .where('messages.client_message_id', '=', sql<string>`'local-panda-reply-v1:' || panda_delivery_intents.id::text`),
        ),
      ),
    )
    .executeTakeFirst()) as LocalPandaDeliveryClaimedUnappliedCountRow | undefined;

  return toCountNumber(row?.claimed_unapplied_intent_count);
}

async function readOldestClaimedUnappliedIntent(
  database: DatabaseClient,
): Promise<LocalPandaDeliveryStatusIntentSummary | null> {
  const row = (await database
    .selectFrom('panda_delivery_intents')
    .select([
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
    .where('status', '=', 'claimed')
    .where('claimed_at', 'is not', null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('messages')
            .select('messages.id')
            .whereRef('messages.conversation_id', '=', 'panda_delivery_intents.conversation_id')
            .where('messages.sender', '=', 'agent')
            .where('messages.client_message_id', '=', sql<string>`'local-panda-reply-v1:' || panda_delivery_intents.id::text`),
        ),
      ),
    )
    .orderBy('claimed_at', 'asc')
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .limit(1)
    .executeTakeFirst()) as LocalPandaDeliveryStatusIntentSummaryRow | undefined;

  return row ? toIntentSummary(row) : null;
}

async function readAppliedLocalReplyCount(database: DatabaseClient): Promise<number> {
  const row = (await database
    .selectFrom('panda_delivery_intents')
    .innerJoin('messages', (join) =>
      join.onRef('messages.conversation_id', '=', 'panda_delivery_intents.conversation_id'),
    )
    .select((eb) => [eb.fn.count<string | number | bigint>('messages.id').as('applied_local_reply_count')])
    .where('messages.sender', '=', 'agent')
    .where('messages.client_message_id', '=', sql<string>`'local-panda-reply-v1:' || panda_delivery_intents.id::text`)
    .executeTakeFirst()) as LocalPandaDeliveryAppliedReplyCountRow | undefined;

  return toCountNumber(row?.applied_local_reply_count);
}

function toIntentSummary(row: LocalPandaDeliveryStatusIntentSummaryRow): LocalPandaDeliveryStatusIntentSummary {
  return {
    id: row.id,
    widgetId: row.widget_id,
    conversationId: row.conversation_id,
    visitorSessionId: row.visitor_session_id,
    visitorMessageId: row.visitor_message_id,
    clientMessageId: row.client_message_id,
    routeHandleSnapshot: row.route_handle_snapshot,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    claimedAt: row.claimed_at ? toIsoString(row.claimed_at) : null,
  };
}

function toCountNumber(value: LocalPandaDeliveryAggregateCount): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return Number(value);
  }

  return 0;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
