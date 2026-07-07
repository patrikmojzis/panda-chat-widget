import { createHash } from 'node:crypto';

import type { Selectable } from 'kysely';

import type { DatabaseExecutor, DatabaseSchema } from './db.ts';
import type { ClaimedPandaDeliveryIntent } from './panda-delivery-intents.ts';

export type LocalPandaDispatchPayloadV1 = {
  version: 1;
  kind: 'local-panda-future-dispatch';
  idempotencyKey: string;
  routeHandleSnapshot: string;
  intent: {
    id: string;
    status: 'claimed';
    createdAt: string;
    claimedAt: string;
  };
  widget: {
    id: string;
  };
  conversation: {
    id: string;
  };
  visitorSession: {
    id: string;
  };
  visitorMessage: {
    id: string;
    clientMessageId: string;
    body: string;
    text: string;
    createdAt: string;
  };
  correlationIds: {
    intentId: string;
    widgetId: string;
    conversationId: string;
    visitorSessionId: string;
    visitorMessageId: string;
    clientMessageId: string;
  };
  metadata: {
    locality: 'local-only';
    dispatch: 'future-dispatch';
    contract: 'contract-only';
    network: 'no-network';
    stateMutation: 'no-state-mutation';
    replyHandling: 'no-reply-handling';
  };
};

export type BuildLocalPandaDispatchPayloadV1Result =
  | {
      built: true;
      payload: LocalPandaDispatchPayloadV1;
    }
  | {
      built: false;
      reason:
        | 'intent_not_claimed'
        | 'missing_route_handle'
        | 'visitor_message_not_found'
        | 'visitor_message_not_visitor'
        | 'message_correlation_mismatch';
    };

type LocalPandaDispatchVisitorMessageRow = Pick<
  Selectable<DatabaseSchema['messages']>,
  'id' | 'conversation_id' | 'sender' | 'client_message_id' | 'body' | 'created_at'
>;

export async function buildLocalPandaDispatchPayloadV1(
  database: DatabaseExecutor,
  claimedIntent: ClaimedPandaDeliveryIntent,
): Promise<BuildLocalPandaDispatchPayloadV1Result> {
  if (claimedIntent.status !== 'claimed' || !isValidDate(claimedIntent.claimedAt)) {
    return { built: false, reason: 'intent_not_claimed' };
  }

  const routeHandleSnapshot = claimedIntent.routeHandleSnapshot;

  if (typeof routeHandleSnapshot !== 'string' || routeHandleSnapshot.trim() === '') {
    return { built: false, reason: 'missing_route_handle' };
  }

  const message = (await database
    .selectFrom('messages')
    .select(['id', 'conversation_id', 'sender', 'client_message_id', 'body', 'created_at'])
    .where('id', '=', claimedIntent.visitorMessageId)
    .executeTakeFirst()) as LocalPandaDispatchVisitorMessageRow | undefined;

  if (!message) {
    return { built: false, reason: 'visitor_message_not_found' };
  }

  if (message.sender !== 'visitor') {
    return { built: false, reason: 'visitor_message_not_visitor' };
  }

  const clientMessageId = message.client_message_id;

  if (
    message.conversation_id !== claimedIntent.conversationId ||
    clientMessageId === null ||
    clientMessageId !== claimedIntent.clientMessageId
  ) {
    return { built: false, reason: 'message_correlation_mismatch' };
  }

  return {
    built: true,
    payload: toLocalPandaDispatchPayloadV1(claimedIntent, message, routeHandleSnapshot, clientMessageId),
  };
}

function toLocalPandaDispatchPayloadV1(
  intent: ClaimedPandaDeliveryIntent,
  message: LocalPandaDispatchVisitorMessageRow,
  routeHandleSnapshot: string,
  clientMessageId: string,
): LocalPandaDispatchPayloadV1 {
  const intentCreatedAt = intent.createdAt.toISOString();
  const intentClaimedAt = intent.claimedAt.toISOString();
  const messageCreatedAt = message.created_at.toISOString();
  const correlationIds = {
    intentId: intent.id,
    widgetId: intent.widgetId,
    conversationId: intent.conversationId,
    visitorSessionId: intent.visitorSessionId,
    visitorMessageId: intent.visitorMessageId,
    clientMessageId,
  };
  const idempotencyKey = buildLocalPandaDispatchPayloadV1IdempotencyKey([
    1,
    'local-panda-future-dispatch',
    correlationIds.intentId,
    correlationIds.widgetId,
    correlationIds.conversationId,
    correlationIds.visitorSessionId,
    correlationIds.visitorMessageId,
    correlationIds.clientMessageId,
    routeHandleSnapshot,
  ]);

  return {
    version: 1,
    kind: 'local-panda-future-dispatch',
    idempotencyKey,
    routeHandleSnapshot,
    intent: {
      id: intent.id,
      status: 'claimed',
      createdAt: intentCreatedAt,
      claimedAt: intentClaimedAt,
    },
    widget: { id: intent.widgetId },
    conversation: { id: intent.conversationId },
    visitorSession: { id: intent.visitorSessionId },
    visitorMessage: {
      id: intent.visitorMessageId,
      clientMessageId,
      body: message.body,
      text: message.body,
      createdAt: messageCreatedAt,
    },
    correlationIds,
    metadata: {
      locality: 'local-only',
      dispatch: 'future-dispatch',
      contract: 'contract-only',
      network: 'no-network',
      stateMutation: 'no-state-mutation',
      replyHandling: 'no-reply-handling',
    },
  };
}

function buildLocalPandaDispatchPayloadV1IdempotencyKey(fields: readonly unknown[]): string {
  const canonicalInput = JSON.stringify(fields);
  const digest = createHash('sha256').update(canonicalInput).digest('hex');

  return `local-panda-dispatch-v1:${digest}`;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
