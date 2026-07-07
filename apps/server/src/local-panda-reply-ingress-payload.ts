import type { LocalPandaDispatchPayloadV1 } from './local-panda-dispatch-payload.ts';

export type LocalPandaReplyIngressCorrelationIds = LocalPandaDispatchPayloadV1['correlationIds'];

export type BuildLocalPandaReplyIngressPayloadV1Input = {
  dispatchPayload: LocalPandaDispatchPayloadV1;
  reply: {
    correlationIds: LocalPandaReplyIngressCorrelationIds;
    text: string;
  };
};

export type LocalPandaReplyIngressPayloadV1 = {
  version: 1;
  kind: 'local-panda-reply-ingress';
  idempotencyKey: string;
  correlationIds: LocalPandaReplyIngressCorrelationIds;
  reply: {
    body: string;
    text: string;
  };
  metadata: {
    locality: 'local-only';
    ingress: 'future-reply';
    contract: 'contract-only';
    network: 'no-network';
    stateMutation: 'no-state-mutation';
    replyInsertion: 'no-reply-insertion';
    replyCardinality: 'one-reply-per-claimed-intent-v1';
  };
};

export type BuildLocalPandaReplyIngressPayloadV1Result =
  | {
      built: true;
      payload: LocalPandaReplyIngressPayloadV1;
    }
  | {
      built: false;
      reason:
        | 'invalid_dispatch_payload'
        | 'invalid_reply_correlation'
        | 'reply_correlation_mismatch'
        | 'invalid_reply_text'
        | 'missing_reply_text';
    };

const correlationIdKeys = [
  'intentId',
  'widgetId',
  'conversationId',
  'visitorSessionId',
  'visitorMessageId',
  'clientMessageId',
] as const;

export function buildLocalPandaReplyIngressPayloadV1(
  input: BuildLocalPandaReplyIngressPayloadV1Input,
): BuildLocalPandaReplyIngressPayloadV1Result {
  const inputRecord = input as unknown;

  if (!isRecord(inputRecord)) {
    return { built: false, reason: 'invalid_dispatch_payload' };
  }

  const dispatchValidation = validateDispatchPayload(inputRecord.dispatchPayload);

  if (!dispatchValidation.valid) {
    return { built: false, reason: 'invalid_dispatch_payload' };
  }

  const replyValidation = validateReplyCorrelation(inputRecord.reply, dispatchValidation.correlationIds);

  if (!replyValidation.valid) {
    return { built: false, reason: replyValidation.reason };
  }

  const textValidation = normalizeReplyText(replyValidation.reply);

  if (!textValidation.valid) {
    return { built: false, reason: textValidation.reason };
  }

  const text = textValidation.text;
  const correlationIds = cloneCorrelationIds(dispatchValidation.correlationIds);

  // V1 intentionally represents one reply per claimed intent; multi-reply or streaming needs a future version/new idempotency identity.
  return {
    built: true,
    payload: {
      version: 1,
      kind: 'local-panda-reply-ingress',
      idempotencyKey: `local-panda-reply-v1:${correlationIds.intentId}`,
      correlationIds,
      reply: {
        body: text,
        text,
      },
      metadata: {
        locality: 'local-only',
        ingress: 'future-reply',
        contract: 'contract-only',
        network: 'no-network',
        stateMutation: 'no-state-mutation',
        replyInsertion: 'no-reply-insertion',
        replyCardinality: 'one-reply-per-claimed-intent-v1',
      },
    },
  };
}

type DispatchValidationResult =
  | {
      valid: true;
      correlationIds: LocalPandaReplyIngressCorrelationIds;
    }
  | {
      valid: false;
    };

function validateDispatchPayload(value: unknown): DispatchValidationResult {
  if (!isRecord(value) || value.version !== 1 || value.kind !== 'local-panda-future-dispatch') {
    return { valid: false };
  }

  const correlationIds = value.correlationIds;

  if (!isValidCorrelationIds(correlationIds)) {
    return { valid: false };
  }

  if (!isValidClaimedIntent(value.intent, correlationIds.intentId)) {
    return { valid: false };
  }

  if (!nestedIdMatches(value.widget, 'id', correlationIds.widgetId)) {
    return { valid: false };
  }

  if (!nestedIdMatches(value.conversation, 'id', correlationIds.conversationId)) {
    return { valid: false };
  }

  if (!nestedIdMatches(value.visitorSession, 'id', correlationIds.visitorSessionId)) {
    return { valid: false };
  }

  if (!isRecord(value.visitorMessage)) {
    return { valid: false };
  }

  if (
    value.visitorMessage.id !== correlationIds.visitorMessageId ||
    value.visitorMessage.clientMessageId !== correlationIds.clientMessageId
  ) {
    return { valid: false };
  }

  return { valid: true, correlationIds: cloneCorrelationIds(correlationIds) };
}

type ReplyCorrelationValidationResult =
  | {
      valid: true;
      reply: Record<string, unknown>;
    }
  | {
      valid: false;
      reason: 'invalid_reply_correlation' | 'reply_correlation_mismatch';
    };

function validateReplyCorrelation(
  value: unknown,
  expectedCorrelationIds: LocalPandaReplyIngressCorrelationIds,
): ReplyCorrelationValidationResult {
  if (!isRecord(value) || !isValidCorrelationIds(value.correlationIds)) {
    return { valid: false, reason: 'invalid_reply_correlation' };
  }

  if (!correlationIdsMatch(value.correlationIds, expectedCorrelationIds)) {
    return { valid: false, reason: 'reply_correlation_mismatch' };
  }

  return { valid: true, reply: value };
}

type ReplyTextValidationResult =
  | {
      valid: true;
      text: string;
    }
  | {
      valid: false;
      reason: 'invalid_reply_text' | 'missing_reply_text';
    };

function normalizeReplyText(value: Record<string, unknown>): ReplyTextValidationResult {
  if (!Object.hasOwn(value, 'text') || value.text === undefined) {
    return { valid: false, reason: 'missing_reply_text' };
  }

  if (typeof value.text !== 'string') {
    return { valid: false, reason: 'invalid_reply_text' };
  }

  const text = value.text.trim();

  if (text === '') {
    return { valid: false, reason: 'missing_reply_text' };
  }

  return { valid: true, text };
}

function isValidClaimedIntent(value: unknown, expectedIntentId: string): boolean {
  return (
    isRecord(value) &&
    value.id === expectedIntentId &&
    value.status === 'claimed' &&
    isNonBlankString(value.claimedAt)
  );
}

function nestedIdMatches(value: unknown, key: 'id', expectedId: string): boolean {
  return isRecord(value) && value[key] === expectedId;
}

function isValidCorrelationIds(value: unknown): value is LocalPandaReplyIngressCorrelationIds {
  return isRecord(value) && correlationIdKeys.every((key) => isNonBlankString(value[key]));
}

function correlationIdsMatch(
  value: LocalPandaReplyIngressCorrelationIds,
  expected: LocalPandaReplyIngressCorrelationIds,
): boolean {
  return correlationIdKeys.every((key) => value[key] === expected[key]);
}

function cloneCorrelationIds(correlationIds: LocalPandaReplyIngressCorrelationIds): LocalPandaReplyIngressCorrelationIds {
  return {
    intentId: correlationIds.intentId,
    widgetId: correlationIds.widgetId,
    conversationId: correlationIds.conversationId,
    visitorSessionId: correlationIds.visitorSessionId,
    visitorMessageId: correlationIds.visitorMessageId,
    clientMessageId: correlationIds.clientMessageId,
  };
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
