import { sql, type Selectable } from 'kysely';

import type { DatabaseClient, DatabaseSchema } from './db.ts';
import {
  prepareNextLocalPandaDispatchDryRun,
  type LocalPandaDispatchDryRunResult,
} from './local-panda-dispatch-dry-run.ts';
import {
  buildLocalPandaDispatchPayloadV1,
  type LocalPandaDispatchPayloadV1,
} from './local-panda-dispatch-payload.ts';
import {
  applyLocalPandaReplyIngressPayloadV1,
  type ApplyLocalPandaReplyIngressPayloadV1Result,
} from './local-panda-reply-ingress-apply.ts';
import {
  buildLocalPandaReplyIngressPayloadV1,
  type BuildLocalPandaReplyIngressPayloadV1Result,
  type LocalPandaReplyIngressPayloadV1,
} from './local-panda-reply-ingress-payload.ts';
import {
  claimQueuedPandaDeliveryIntentById,
  type ClaimedPandaDeliveryIntent,
} from './panda-delivery-intents.ts';

type LocalPandaReplyRoundTripUntargetedDispatchFailureReason = Extract<
  LocalPandaDispatchDryRunResult,
  { prepared: false }
>['reason'];

type LocalPandaReplyRoundTripDispatchBuildFailureReason = Exclude<
  LocalPandaReplyRoundTripUntargetedDispatchFailureReason,
  'no_queued_intent'
>;

export type LocalPandaReplyRoundTripTargetFailureReason =
  | 'target_intent_not_found'
  | 'target_intent_already_applied'
  | 'target_intent_not_replyable';

type LocalPandaReplyRoundTripDispatchNoSourceFailureReason =
  | 'no_queued_intent'
  | LocalPandaReplyRoundTripTargetFailureReason;

type LocalPandaReplyRoundTripBuildFailureReason = Extract<
  BuildLocalPandaReplyIngressPayloadV1Result,
  { built: false }
>['reason'];

type LocalPandaReplyRoundTripApplyFailure = Extract<
  ApplyLocalPandaReplyIngressPayloadV1Result,
  { applied: false }
>;

type LocalPandaReplyRoundTripApplySuccess = Extract<
  ApplyLocalPandaReplyIngressPayloadV1Result,
  { applied: true }
>;

export type LocalPandaReplyRoundTripDispatchIntentSource =
  | 'already-claimed-unapplied-local-intent'
  | 'newly-claimed-queued-local-intent'
  | 'targeted-already-claimed-unapplied-local-intent'
  | 'targeted-newly-claimed-queued-local-intent';

export type LocalPandaReplyRoundTripMetadata = {
  locality: 'local-only';
  network: 'no-network';
  pandaCall: 'not-attempted';
  gatewayCall: 'not-attempted';
  externalCliCall: 'not-attempted';
  childProcess: 'not-used';
  replySource: 'deterministic-local-fake-reply';
  stateMutation: 'reuses-one-claimed-intent-or-claims-one-queued-intent-and-inserts-or-replays-one-local-agent-message';
  publicFakeReplyReplacement: 'not-attempted';
  postClaimFailure: 'intent-may-remain-claimed-after-dispatch-build-or-apply-failure';
  rollback: 'not-attempted';
  statusLifecycleExpansion: 'not-attempted';
};

export type LocalPandaReplyRoundTripBase = {
  kind: 'local-panda-one-shot-deterministic-fake-reply-round-trip';
  mode: 'local-only-no-network-deterministic-fake-reply';
  metadata: LocalPandaReplyRoundTripMetadata;
  targetIntentId?: string;
};

export type LocalPandaReplyRoundTripResult =
  | (LocalPandaReplyRoundTripBase & {
      completed: true;
      dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource;
      dispatchPayload: LocalPandaDispatchPayloadV1;
      syntheticFakeReplyIngressPayload: LocalPandaReplyIngressPayloadV1;
      applyResult: LocalPandaReplyRoundTripApplySuccess;
    })
  | (LocalPandaReplyRoundTripBase & {
      completed: false;
      failedStep: 'dispatch_prepare';
      reason: LocalPandaReplyRoundTripDispatchNoSourceFailureReason;
    })
  | (LocalPandaReplyRoundTripBase & {
      completed: false;
      failedStep: 'dispatch_prepare';
      reason: LocalPandaReplyRoundTripDispatchBuildFailureReason;
      dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource;
    })
  | (LocalPandaReplyRoundTripBase & {
      completed: false;
      failedStep: 'synthetic_fake_reply_ingress_build';
      reason: LocalPandaReplyRoundTripBuildFailureReason;
      dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource;
      dispatchPayload: LocalPandaDispatchPayloadV1;
    })
  | (LocalPandaReplyRoundTripBase & {
      completed: false;
      failedStep: 'apply_reply_ingress';
      reason: LocalPandaReplyRoundTripApplyFailure['reason'];
      dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource;
      dispatchPayload: LocalPandaDispatchPayloadV1;
      syntheticFakeReplyIngressPayload: LocalPandaReplyIngressPayloadV1;
      applyResult: LocalPandaReplyRoundTripApplyFailure;
    });

export type LocalPandaReplyRoundTripOptions = {
  now?: Date;
  targetIntentId?: string;
};

export type LocalPandaReplyRoundTripDispatchPreparationResult =
  | {
      prepared: true;
      dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource;
      payload: LocalPandaDispatchPayloadV1;
      targetIntentId?: string;
    }
  | {
      prepared: false;
      reason: LocalPandaReplyRoundTripDispatchNoSourceFailureReason;
      targetIntentId?: string;
    }
  | {
      prepared: false;
      reason: LocalPandaReplyRoundTripDispatchBuildFailureReason;
      dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource;
      targetIntentId?: string;
    };

type LocalPandaReplyRoundTripIntentRow = Pick<
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

const ROUND_TRIP_KIND = 'local-panda-one-shot-deterministic-fake-reply-round-trip';
const ROUND_TRIP_MODE = 'local-only-no-network-deterministic-fake-reply';
const ALREADY_CLAIMED_UNAPPLIED_SOURCE = 'already-claimed-unapplied-local-intent';
const NEWLY_CLAIMED_QUEUED_SOURCE = 'newly-claimed-queued-local-intent';
const TARGETED_ALREADY_CLAIMED_UNAPPLIED_SOURCE = 'targeted-already-claimed-unapplied-local-intent';
const TARGETED_NEWLY_CLAIMED_QUEUED_SOURCE = 'targeted-newly-claimed-queued-local-intent';
const ROUND_TRIP_METADATA: LocalPandaReplyRoundTripMetadata = {
  locality: 'local-only',
  network: 'no-network',
  pandaCall: 'not-attempted',
  gatewayCall: 'not-attempted',
  externalCliCall: 'not-attempted',
  childProcess: 'not-used',
  replySource: 'deterministic-local-fake-reply',
  stateMutation: 'reuses-one-claimed-intent-or-claims-one-queued-intent-and-inserts-or-replays-one-local-agent-message',
  publicFakeReplyReplacement: 'not-attempted',
  postClaimFailure: 'intent-may-remain-claimed-after-dispatch-build-or-apply-failure',
  rollback: 'not-attempted',
  statusLifecycleExpansion: 'not-attempted',
};

export async function runNextLocalPandaReplyRoundTrip(
  database: DatabaseClient,
  options: LocalPandaReplyRoundTripOptions = {},
): Promise<LocalPandaReplyRoundTripResult> {
  const helperOptions = normalizeRoundTripOptions(options);
  const dispatchResult = await prepareLocalPandaReplyRoundTripDispatch(database, helperOptions);

  if (!dispatchResult.prepared) {
    if ('dispatchIntentSource' in dispatchResult) {
      return {
        ...roundTripBase(),
        ...targetIntentOutput(dispatchResult.targetIntentId),
        completed: false,
        failedStep: 'dispatch_prepare',
        reason: dispatchResult.reason,
        dispatchIntentSource: dispatchResult.dispatchIntentSource,
      };
    }

    return {
      ...roundTripBase(),
      ...targetIntentOutput(dispatchResult.targetIntentId),
      completed: false,
      failedStep: 'dispatch_prepare',
      reason: dispatchResult.reason,
    };
  }

  return completeLocalPandaReplyRoundTripDispatch(
    database,
    dispatchResult.payload,
    dispatchResult.dispatchIntentSource,
    helperOptions,
    dispatchResult.targetIntentId,
  );
}

export async function prepareLocalPandaReplyRoundTripDispatch(
  database: DatabaseClient,
  options: LocalPandaReplyRoundTripOptions = {},
): Promise<LocalPandaReplyRoundTripDispatchPreparationResult> {
  if (options.targetIntentId !== undefined) {
    return prepareTargetedLocalPandaReplyRoundTripDispatch(database, options.targetIntentId, options);
  }

  const claimedUnappliedIntent = await findOldestClaimedUnappliedLocalPandaIntent(database);

  if (claimedUnappliedIntent) {
    return buildDispatchPreparationFromClaimedIntent(
      database,
      claimedUnappliedIntent,
      ALREADY_CLAIMED_UNAPPLIED_SOURCE,
    );
  }

  const dispatchResult = await prepareNextLocalPandaDispatchDryRun(database, options);

  if (!dispatchResult.prepared) {
    if (dispatchResult.reason === 'no_queued_intent') {
      return { prepared: false, reason: 'no_queued_intent' };
    }

    return {
      prepared: false,
      reason: dispatchResult.reason,
      dispatchIntentSource: NEWLY_CLAIMED_QUEUED_SOURCE,
    };
  }

  return {
    prepared: true,
    dispatchIntentSource: NEWLY_CLAIMED_QUEUED_SOURCE,
    payload: dispatchResult.payload,
  };
}

async function prepareTargetedLocalPandaReplyRoundTripDispatch(
  database: DatabaseClient,
  targetIntentId: string,
  options: LocalPandaReplyRoundTripOptions,
): Promise<LocalPandaReplyRoundTripDispatchPreparationResult> {
  const targetIntent = await findLocalPandaIntentById(database, targetIntentId);

  if (!targetIntent) {
    return { prepared: false, reason: 'target_intent_not_found', targetIntentId };
  }

  if (await hasAppliedLocalPandaReply(database, targetIntent)) {
    return { prepared: false, reason: 'target_intent_already_applied', targetIntentId };
  }

  if (targetIntent.status === 'queued') {
    const claimedIntent = await claimQueuedPandaDeliveryIntentById(database, targetIntentId, options);

    if (!claimedIntent) {
      return { prepared: false, reason: 'target_intent_not_replyable', targetIntentId };
    }

    return buildDispatchPreparationFromClaimedIntent(
      database,
      claimedIntent,
      TARGETED_NEWLY_CLAIMED_QUEUED_SOURCE,
      targetIntentId,
    );
  }

  if (targetIntent.status === 'claimed' && targetIntent.claimed_at) {
    return buildDispatchPreparationFromClaimedIntent(
      database,
      toClaimedPandaDeliveryIntent(targetIntent),
      TARGETED_ALREADY_CLAIMED_UNAPPLIED_SOURCE,
      targetIntentId,
    );
  }

  return { prepared: false, reason: 'target_intent_not_replyable', targetIntentId };
}

async function buildDispatchPreparationFromClaimedIntent(
  database: DatabaseClient,
  claimedIntent: ClaimedPandaDeliveryIntent,
  dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource,
  targetIntentId?: string,
): Promise<LocalPandaReplyRoundTripDispatchPreparationResult> {
  const buildResult = await buildLocalPandaDispatchPayloadV1(database, claimedIntent);

  if (!buildResult.built) {
    return {
      prepared: false,
      reason: buildResult.reason,
      dispatchIntentSource,
      ...targetIntentOutput(targetIntentId),
    };
  }

  return {
    prepared: true,
    dispatchIntentSource,
    payload: buildResult.payload,
    ...targetIntentOutput(targetIntentId),
  };
}

async function completeLocalPandaReplyRoundTripDispatch(
  database: DatabaseClient,
  dispatchPayload: LocalPandaDispatchPayloadV1,
  dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource,
  options: LocalPandaReplyRoundTripOptions,
  targetIntentId?: string,
): Promise<LocalPandaReplyRoundTripResult> {
  const syntheticReplyText = buildDeterministicLocalFakeReplyText(dispatchPayload.correlationIds.intentId);
  const replyIngressResult = buildLocalPandaReplyIngressPayloadV1({
    dispatchPayload,
    reply: {
      correlationIds: dispatchPayload.correlationIds,
      text: syntheticReplyText,
    },
  });

  if (!replyIngressResult.built) {
    return {
      ...roundTripBase(),
      ...targetIntentOutput(targetIntentId),
      completed: false,
      failedStep: 'synthetic_fake_reply_ingress_build',
      reason: replyIngressResult.reason,
      dispatchIntentSource,
      dispatchPayload,
    };
  }

  const syntheticFakeReplyIngressPayload = replyIngressResult.payload;
  const applyResult = await applyLocalPandaReplyIngressPayloadV1(
    database,
    syntheticFakeReplyIngressPayload,
    options,
  );

  if (!applyResult.applied) {
    return {
      ...roundTripBase(),
      ...targetIntentOutput(targetIntentId),
      completed: false,
      failedStep: 'apply_reply_ingress',
      reason: applyResult.reason,
      dispatchIntentSource,
      dispatchPayload,
      syntheticFakeReplyIngressPayload,
      applyResult,
    };
  }

  return {
    ...roundTripBase(),
    ...targetIntentOutput(targetIntentId),
    completed: true,
    dispatchIntentSource,
    dispatchPayload,
    syntheticFakeReplyIngressPayload,
    applyResult,
  };
}

async function findLocalPandaIntentById(
  database: DatabaseClient,
  targetIntentId: string,
): Promise<LocalPandaReplyRoundTripIntentRow | null> {
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
    .where('id', '=', targetIntentId)
    .executeTakeFirst()) as LocalPandaReplyRoundTripIntentRow | undefined;

  return row ?? null;
}

async function hasAppliedLocalPandaReply(
  database: DatabaseClient,
  intent: Pick<LocalPandaReplyRoundTripIntentRow, 'id' | 'conversation_id'>,
): Promise<boolean> {
  const row = await database
    .selectFrom('messages')
    .select('id')
    .where('conversation_id', '=', intent.conversation_id)
    .where('sender', '=', 'agent')
    .where('client_message_id', '=', localPandaReplyClientMessageId(intent.id))
    .executeTakeFirst();

  return row !== undefined;
}

async function findOldestClaimedUnappliedLocalPandaIntent(
  database: DatabaseClient,
): Promise<ClaimedPandaDeliveryIntent | null> {
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
    .executeTakeFirst()) as LocalPandaReplyRoundTripIntentRow | undefined;

  return row ? toClaimedPandaDeliveryIntent(row) : null;
}

function toClaimedPandaDeliveryIntent(row: LocalPandaReplyRoundTripIntentRow): ClaimedPandaDeliveryIntent {
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

function normalizeRoundTripOptions(options: LocalPandaReplyRoundTripOptions): LocalPandaReplyRoundTripOptions {
  return {
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.targetIntentId === undefined ? {} : { targetIntentId: options.targetIntentId }),
  };
}

function targetIntentOutput(targetIntentId: string | undefined): { targetIntentId?: string } {
  return targetIntentId === undefined ? {} : { targetIntentId };
}

function localPandaReplyClientMessageId(intentId: string): string {
  return `local-panda-reply-v1:${intentId}`;
}

function buildDeterministicLocalFakeReplyText(intentId: string): string {
  return `Deterministic local fake reply for intent ${intentId}. No Panda, Gateway, external CLI, child process, or network call was attempted.`;
}

function roundTripBase(): LocalPandaReplyRoundTripBase {
  return {
    kind: ROUND_TRIP_KIND,
    mode: ROUND_TRIP_MODE,
    metadata: { ...ROUND_TRIP_METADATA },
  };
}
