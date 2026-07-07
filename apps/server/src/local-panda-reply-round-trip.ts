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
import type { ClaimedPandaDeliveryIntent } from './panda-delivery-intents.ts';

type LocalPandaReplyRoundTripDispatchFailureReason = Extract<
  LocalPandaDispatchDryRunResult,
  { prepared: false }
>['reason'];

type LocalPandaReplyRoundTripDispatchBuildFailureReason = Exclude<
  LocalPandaReplyRoundTripDispatchFailureReason,
  'no_queued_intent'
>;

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
  | 'newly-claimed-queued-local-intent';

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
      reason: 'no_queued_intent';
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
};

export type LocalPandaReplyRoundTripDispatchPreparationResult =
  | {
      prepared: true;
      dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource;
      payload: LocalPandaDispatchPayloadV1;
    }
  | {
      prepared: false;
      reason: 'no_queued_intent';
    }
  | {
      prepared: false;
      reason: LocalPandaReplyRoundTripDispatchBuildFailureReason;
      dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource;
    };

type ClaimedUnappliedLocalPandaIntentRow = Pick<
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
  const helperOptions = options.now === undefined ? {} : { now: options.now };
  const dispatchResult = await prepareLocalPandaReplyRoundTripDispatch(database, helperOptions);

  if (!dispatchResult.prepared) {
    if ('dispatchIntentSource' in dispatchResult) {
      return {
        ...roundTripBase(),
        completed: false,
        failedStep: 'dispatch_prepare',
        reason: dispatchResult.reason,
        dispatchIntentSource: dispatchResult.dispatchIntentSource,
      };
    }

    return {
      ...roundTripBase(),
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
  );
}

export async function prepareLocalPandaReplyRoundTripDispatch(
  database: DatabaseClient,
  options: LocalPandaReplyRoundTripOptions,
): Promise<LocalPandaReplyRoundTripDispatchPreparationResult> {
  const claimedUnappliedIntent = await findOldestClaimedUnappliedLocalPandaIntent(database);

  if (claimedUnappliedIntent) {
    const buildResult = await buildLocalPandaDispatchPayloadV1(database, claimedUnappliedIntent);

    if (!buildResult.built) {
      return {
        prepared: false,
        reason: buildResult.reason,
        dispatchIntentSource: ALREADY_CLAIMED_UNAPPLIED_SOURCE,
      };
    }

    return {
      prepared: true,
      dispatchIntentSource: ALREADY_CLAIMED_UNAPPLIED_SOURCE,
      payload: buildResult.payload,
    };
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

async function completeLocalPandaReplyRoundTripDispatch(
  database: DatabaseClient,
  dispatchPayload: LocalPandaDispatchPayloadV1,
  dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource,
  options: LocalPandaReplyRoundTripOptions,
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
    completed: true,
    dispatchIntentSource,
    dispatchPayload,
    syntheticFakeReplyIngressPayload,
    applyResult,
  };
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
    .executeTakeFirst()) as ClaimedUnappliedLocalPandaIntentRow | undefined;

  return row ? toClaimedPandaDeliveryIntent(row) : null;
}

function toClaimedPandaDeliveryIntent(row: ClaimedUnappliedLocalPandaIntentRow): ClaimedPandaDeliveryIntent {
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
