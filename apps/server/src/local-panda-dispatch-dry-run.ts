import type { DatabaseClient } from './db.ts';
import {
  buildLocalPandaDispatchPayloadV1,
  type BuildLocalPandaDispatchPayloadV1Result,
  type LocalPandaDispatchPayloadV1,
} from './local-panda-dispatch-payload.ts';
import {
  claimNextQueuedPandaDeliveryIntent,
  type ClaimPandaDeliveryIntentOptions,
} from './panda-delivery-intents.ts';

type LocalPandaDispatchDryRunBuildFailureReason = Extract<
  BuildLocalPandaDispatchPayloadV1Result,
  { built: false }
>['reason'];

export type LocalPandaDispatchDryRunResult =
  | {
      prepared: true;
      payload: LocalPandaDispatchPayloadV1;
    }
  | {
      prepared: false;
      reason: 'no_queued_intent' | LocalPandaDispatchDryRunBuildFailureReason;
    };

export type LocalPandaDispatchDryRunOptions = ClaimPandaDeliveryIntentOptions;

export async function prepareNextLocalPandaDispatchDryRun(
  database: DatabaseClient,
  options: LocalPandaDispatchDryRunOptions = {},
): Promise<LocalPandaDispatchDryRunResult> {
  const claimedIntent = await claimNextQueuedPandaDeliveryIntent(database, options);

  if (!claimedIntent) {
    return { prepared: false, reason: 'no_queued_intent' };
  }

  const buildResult = await buildLocalPandaDispatchPayloadV1(database, claimedIntent);

  if (!buildResult.built) {
    return { prepared: false, reason: buildResult.reason };
  }

  return { prepared: true, payload: buildResult.payload };
}
