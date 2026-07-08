import type { DatabaseClient } from './db.ts';
import type { LocalPandaDispatchPayloadV1 } from './local-panda-dispatch-payload.ts';
import {
  applyLocalPandaReplyIngressPayloadV1,
  type ApplyLocalPandaReplyIngressPayloadV1Options,
  type ApplyLocalPandaReplyIngressPayloadV1Result,
} from './local-panda-reply-ingress-apply.ts';
import {
  buildLocalPandaReplyIngressPayloadV1,
  type BuildLocalPandaReplyIngressPayloadV1Input,
  type BuildLocalPandaReplyIngressPayloadV1Result,
  type LocalPandaReplyIngressPayloadV1,
} from './local-panda-reply-ingress-payload.ts';
import {
  prepareLocalPandaReplyRoundTripDispatch,
  type LocalPandaReplyRoundTripDispatchIntentSource,
  type LocalPandaReplyRoundTripDispatchPreparationResult,
  type LocalPandaReplyRoundTripOptions,
} from './local-panda-reply-round-trip.ts';

type LocalPandaReplyManualDispatchFailure = Extract<
  LocalPandaReplyRoundTripDispatchPreparationResult,
  { prepared: false }
>;

type LocalPandaReplyManualDispatchFailureReason = LocalPandaReplyManualDispatchFailure['reason'];

type LocalPandaReplyManualDispatchBuildFailureReason = Extract<
  LocalPandaReplyManualDispatchFailure,
  { dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource }
>['reason'];

type LocalPandaReplyManualDispatchNoSourceFailureReason = Exclude<
  LocalPandaReplyManualDispatchFailureReason,
  LocalPandaReplyManualDispatchBuildFailureReason
>;

type LocalPandaReplyManualBuildFailure = Extract<BuildLocalPandaReplyIngressPayloadV1Result, { built: false }>;
type LocalPandaReplyManualApplyFailure = Extract<ApplyLocalPandaReplyIngressPayloadV1Result, { applied: false }>;
type LocalPandaReplyManualApplySuccess = Extract<ApplyLocalPandaReplyIngressPayloadV1Result, { applied: true }>;

export type LocalPandaReplyManualMetadata = {
  locality: 'local-only';
  input: 'stdin-json-object';
  manualReplySource: 'stdin-manual-reply-text';
  replyTextValidation: 'normalized-before-db-config-or-dispatch';
  network: 'no-network';
  pandaCall: 'not-attempted';
  gatewayCall: 'not-attempted';
  externalCliCall: 'not-attempted';
  childProcess: 'not-used';
  publicRoute: 'not-created';
  worker: 'not-created';
  frontendExposure: 'not-created';
  stateMutation: 'reuses-one-claimed-intent-or-claims-one-queued-intent-and-inserts-or-replays-one-local-agent-message';
  publicFakeReplyReplacement: 'not-attempted';
  postClaimFailure: 'intent-may-remain-claimed-after-dispatch-build-or-apply-failure';
  rollback: 'not-attempted';
  statusLifecycleExpansion: 'not-attempted';
};

export type LocalPandaReplyManualBase = {
  kind: 'local-panda-one-shot-manual-reply-round-trip';
  mode: 'local-only-stdin-manual-reply';
  metadata: LocalPandaReplyManualMetadata;
  targetIntentId?: string;
};

export type LocalPandaReplyManualResult =
  | (LocalPandaReplyManualBase & {
      completed: true;
      parsed: true;
      dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource;
      dispatchPayload: LocalPandaDispatchPayloadV1;
      manualReplyIngressPayload: LocalPandaReplyIngressPayloadV1;
      applyResult: LocalPandaReplyManualApplySuccess;
    })
  | (LocalPandaReplyManualBase & {
      completed: false;
      parsed: true;
      failedStep: 'dispatch_prepare';
      reason: LocalPandaReplyManualDispatchNoSourceFailureReason;
    })
  | (LocalPandaReplyManualBase & {
      completed: false;
      parsed: true;
      failedStep: 'dispatch_prepare';
      reason: LocalPandaReplyManualDispatchBuildFailureReason;
      dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource;
    })
  | (LocalPandaReplyManualBase & {
      completed: false;
      parsed: true;
      failedStep: 'manual_reply_ingress_build';
      reason: LocalPandaReplyManualBuildFailure['reason'];
      dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource;
      dispatchPayload: LocalPandaDispatchPayloadV1;
      buildResult: LocalPandaReplyManualBuildFailure;
    })
  | (LocalPandaReplyManualBase & {
      completed: false;
      parsed: true;
      failedStep: 'apply_reply_ingress';
      reason: LocalPandaReplyManualApplyFailure['reason'];
      dispatchIntentSource: LocalPandaReplyRoundTripDispatchIntentSource;
      dispatchPayload: LocalPandaDispatchPayloadV1;
      manualReplyIngressPayload: LocalPandaReplyIngressPayloadV1;
      applyResult: LocalPandaReplyManualApplyFailure;
    });

export type LocalPandaReplyManualInput = {
  normalizedReplyText: string;
  targetIntentId?: string;
};

export type LocalPandaReplyManualOptions = ApplyLocalPandaReplyIngressPayloadV1Options;

export type LocalPandaReplyManualDependencies = {
  applyLocalPandaReplyIngressPayloadV1?: (
    database: DatabaseClient,
    payload: LocalPandaReplyIngressPayloadV1,
    options?: ApplyLocalPandaReplyIngressPayloadV1Options,
  ) => Promise<ApplyLocalPandaReplyIngressPayloadV1Result>;
  buildLocalPandaReplyIngressPayloadV1?: (
    input: BuildLocalPandaReplyIngressPayloadV1Input,
  ) => BuildLocalPandaReplyIngressPayloadV1Result;
  prepareLocalPandaReplyRoundTripDispatch?: (
    database: DatabaseClient,
    options: LocalPandaReplyRoundTripOptions,
  ) => Promise<LocalPandaReplyRoundTripDispatchPreparationResult>;
};

const MANUAL_REPLY_KIND = 'local-panda-one-shot-manual-reply-round-trip';
const MANUAL_REPLY_MODE = 'local-only-stdin-manual-reply';
const MANUAL_REPLY_METADATA: LocalPandaReplyManualMetadata = {
  locality: 'local-only',
  input: 'stdin-json-object',
  manualReplySource: 'stdin-manual-reply-text',
  replyTextValidation: 'normalized-before-db-config-or-dispatch',
  network: 'no-network',
  pandaCall: 'not-attempted',
  gatewayCall: 'not-attempted',
  externalCliCall: 'not-attempted',
  childProcess: 'not-used',
  publicRoute: 'not-created',
  worker: 'not-created',
  frontendExposure: 'not-created',
  stateMutation: 'reuses-one-claimed-intent-or-claims-one-queued-intent-and-inserts-or-replays-one-local-agent-message',
  publicFakeReplyReplacement: 'not-attempted',
  postClaimFailure: 'intent-may-remain-claimed-after-dispatch-build-or-apply-failure',
  rollback: 'not-attempted',
  statusLifecycleExpansion: 'not-attempted',
};

export async function runNextLocalPandaReplyManual(
  database: DatabaseClient,
  input: LocalPandaReplyManualInput,
  options: LocalPandaReplyManualOptions = {},
  dependencies: LocalPandaReplyManualDependencies = {},
): Promise<LocalPandaReplyManualResult> {
  const resolved = resolveDependencies(dependencies);
  const dispatchOptions = buildDispatchOptions(input, options);
  const applyOptions = buildApplyOptions(options);
  const dispatchResult = await resolved.prepareLocalPandaReplyRoundTripDispatch(database, dispatchOptions);

  if (!dispatchResult.prepared) {
    const targetIntentId = dispatchResult.targetIntentId ?? input.targetIntentId;

    if ('dispatchIntentSource' in dispatchResult) {
      return {
        ...manualReplyBase(),
        ...targetIntentOutput(targetIntentId),
        completed: false,
        parsed: true,
        failedStep: 'dispatch_prepare',
        reason: dispatchResult.reason,
        dispatchIntentSource: dispatchResult.dispatchIntentSource,
      };
    }

    return {
      ...manualReplyBase(),
      ...targetIntentOutput(targetIntentId),
      completed: false,
      parsed: true,
      failedStep: 'dispatch_prepare',
      reason: dispatchResult.reason,
    };
  }

  const targetIntentId = dispatchResult.targetIntentId ?? input.targetIntentId;
  const dispatchPayload = dispatchResult.payload;
  const buildResult = resolved.buildLocalPandaReplyIngressPayloadV1({
    dispatchPayload,
    reply: {
      correlationIds: dispatchPayload.correlationIds,
      text: input.normalizedReplyText,
    },
  });

  if (!buildResult.built) {
    return {
      ...manualReplyBase(),
      ...targetIntentOutput(targetIntentId),
      completed: false,
      parsed: true,
      failedStep: 'manual_reply_ingress_build',
      reason: buildResult.reason,
      dispatchIntentSource: dispatchResult.dispatchIntentSource,
      dispatchPayload,
      buildResult,
    };
  }

  const manualReplyIngressPayload = buildResult.payload;
  const applyResult = await resolved.applyLocalPandaReplyIngressPayloadV1(
    database,
    manualReplyIngressPayload,
    applyOptions,
  );

  if (!applyResult.applied) {
    return {
      ...manualReplyBase(),
      ...targetIntentOutput(targetIntentId),
      completed: false,
      parsed: true,
      failedStep: 'apply_reply_ingress',
      reason: applyResult.reason,
      dispatchIntentSource: dispatchResult.dispatchIntentSource,
      dispatchPayload,
      manualReplyIngressPayload,
      applyResult,
    };
  }

  return {
    ...manualReplyBase(),
    ...targetIntentOutput(targetIntentId),
    completed: true,
    parsed: true,
    dispatchIntentSource: dispatchResult.dispatchIntentSource,
    dispatchPayload,
    manualReplyIngressPayload,
    applyResult,
  };
}

function resolveDependencies(dependencies: LocalPandaReplyManualDependencies): Required<LocalPandaReplyManualDependencies> {
  return {
    applyLocalPandaReplyIngressPayloadV1:
      dependencies.applyLocalPandaReplyIngressPayloadV1 ?? applyLocalPandaReplyIngressPayloadV1,
    buildLocalPandaReplyIngressPayloadV1:
      dependencies.buildLocalPandaReplyIngressPayloadV1 ?? buildLocalPandaReplyIngressPayloadV1,
    prepareLocalPandaReplyRoundTripDispatch:
      dependencies.prepareLocalPandaReplyRoundTripDispatch ?? prepareLocalPandaReplyRoundTripDispatch,
  };
}

function buildDispatchOptions(
  input: LocalPandaReplyManualInput,
  options: LocalPandaReplyManualOptions,
): LocalPandaReplyRoundTripOptions {
  return {
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(input.targetIntentId === undefined ? {} : { targetIntentId: input.targetIntentId }),
  };
}

function buildApplyOptions(options: LocalPandaReplyManualOptions): ApplyLocalPandaReplyIngressPayloadV1Options {
  return options.now === undefined ? {} : { now: options.now };
}

function targetIntentOutput(targetIntentId: string | undefined): { targetIntentId?: string } {
  return targetIntentId === undefined ? {} : { targetIntentId };
}

function manualReplyBase(): LocalPandaReplyManualBase {
  return {
    kind: MANUAL_REPLY_KIND,
    mode: MANUAL_REPLY_MODE,
    metadata: { ...MANUAL_REPLY_METADATA },
  };
}
