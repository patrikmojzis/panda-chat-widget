import type { DatabaseClient } from './db.ts';
import {
  prepareNextLocalPandaDispatchDryRun,
  type LocalPandaDispatchDryRunResult,
} from './local-panda-dispatch-dry-run.ts';
import type { LocalPandaDispatchPayloadV1 } from './local-panda-dispatch-payload.ts';
import {
  applyLocalPandaReplyIngressPayloadV1,
  type ApplyLocalPandaReplyIngressPayloadV1Result,
} from './local-panda-reply-ingress-apply.ts';
import {
  buildLocalPandaReplyIngressPayloadV1,
  type BuildLocalPandaReplyIngressPayloadV1Result,
  type LocalPandaReplyIngressPayloadV1,
} from './local-panda-reply-ingress-payload.ts';

type LocalPandaReplyRoundTripDispatchFailureReason = Extract<
  LocalPandaDispatchDryRunResult,
  { prepared: false }
>['reason'];

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

export type LocalPandaReplyRoundTripMetadata = {
  locality: 'local-only';
  network: 'no-network';
  pandaCall: 'not-attempted';
  gatewayCall: 'not-attempted';
  externalCliCall: 'not-attempted';
  childProcess: 'not-used';
  replySource: 'deterministic-local-fake-reply';
  stateMutation: 'claims-one-intent-and-inserts-or-replays-one-local-agent-message';
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
      dispatchPayload: LocalPandaDispatchPayloadV1;
      syntheticFakeReplyIngressPayload: LocalPandaReplyIngressPayloadV1;
      applyResult: LocalPandaReplyRoundTripApplySuccess;
    })
  | (LocalPandaReplyRoundTripBase & {
      completed: false;
      failedStep: 'dispatch_prepare';
      reason: LocalPandaReplyRoundTripDispatchFailureReason;
    })
  | (LocalPandaReplyRoundTripBase & {
      completed: false;
      failedStep: 'synthetic_fake_reply_ingress_build';
      reason: LocalPandaReplyRoundTripBuildFailureReason;
      dispatchPayload: LocalPandaDispatchPayloadV1;
    })
  | (LocalPandaReplyRoundTripBase & {
      completed: false;
      failedStep: 'apply_reply_ingress';
      reason: LocalPandaReplyRoundTripApplyFailure['reason'];
      dispatchPayload: LocalPandaDispatchPayloadV1;
      syntheticFakeReplyIngressPayload: LocalPandaReplyIngressPayloadV1;
      applyResult: LocalPandaReplyRoundTripApplyFailure;
    });

export type LocalPandaReplyRoundTripOptions = {
  now?: Date;
};

const ROUND_TRIP_KIND = 'local-panda-one-shot-deterministic-fake-reply-round-trip';
const ROUND_TRIP_MODE = 'local-only-no-network-deterministic-fake-reply';
const ROUND_TRIP_METADATA: LocalPandaReplyRoundTripMetadata = {
  locality: 'local-only',
  network: 'no-network',
  pandaCall: 'not-attempted',
  gatewayCall: 'not-attempted',
  externalCliCall: 'not-attempted',
  childProcess: 'not-used',
  replySource: 'deterministic-local-fake-reply',
  stateMutation: 'claims-one-intent-and-inserts-or-replays-one-local-agent-message',
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
  const dispatchResult = await prepareNextLocalPandaDispatchDryRun(database, helperOptions);

  if (!dispatchResult.prepared) {
    return {
      ...roundTripBase(),
      completed: false,
      failedStep: 'dispatch_prepare',
      reason: dispatchResult.reason,
    };
  }

  const dispatchPayload = dispatchResult.payload;
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
      dispatchPayload,
    };
  }

  const syntheticFakeReplyIngressPayload = replyIngressResult.payload;
  const applyResult = await applyLocalPandaReplyIngressPayloadV1(
    database,
    syntheticFakeReplyIngressPayload,
    helperOptions,
  );

  if (!applyResult.applied) {
    return {
      ...roundTripBase(),
      completed: false,
      failedStep: 'apply_reply_ingress',
      reason: applyResult.reason,
      dispatchPayload,
      syntheticFakeReplyIngressPayload,
      applyResult,
    };
  }

  return {
    ...roundTripBase(),
    completed: true,
    dispatchPayload,
    syntheticFakeReplyIngressPayload,
    applyResult,
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
