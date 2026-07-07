import type { Insertable, Selectable } from 'kysely';

import type { DatabaseClient, DatabaseExecutor, DatabaseSchema } from './db.ts';
import type { LocalPandaReplyIngressPayloadV1 } from './local-panda-reply-ingress-payload.ts';
import { getNextMessageSeq, type ConversationMessage } from './message.ts';

export type ApplyLocalPandaReplyIngressPayloadV1FailureReason =
  | 'invalid_payload'
  | 'conversation_not_found'
  | 'conversation_correlation_mismatch'
  | 'intent_not_found'
  | 'intent_not_claimed'
  | 'intent_correlation_mismatch'
  | 'visitor_message_not_found'
  | 'visitor_message_not_visitor'
  | 'visitor_message_correlation_mismatch'
  | 'idempotency_conflict'
  | 'message_insert_conflict';

export type ApplyLocalPandaReplyIngressPayloadV1Result =
  | { applied: true; inserted: true; message: ConversationMessage }
  | { applied: true; inserted: false; message: ConversationMessage }
  | { applied: false; reason: ApplyLocalPandaReplyIngressPayloadV1FailureReason };

export type ApplyLocalPandaReplyIngressPayloadV1Options = {
  now?: Date;
};

type ValidatedReplyIngressPayload = {
  correlationIds: LocalPandaReplyIngressPayloadV1['correlationIds'];
  idempotencyKey: string;
  replyBody: string;
};

type ConversationRow = Pick<
  Selectable<DatabaseSchema['conversations']>,
  'id' | 'widget_id' | 'visitor_session_id'
>;

type PandaDeliveryIntentRow = Pick<
  Selectable<DatabaseSchema['panda_delivery_intents']>,
  | 'id'
  | 'widget_id'
  | 'conversation_id'
  | 'visitor_session_id'
  | 'visitor_message_id'
  | 'client_message_id'
  | 'status'
  | 'claimed_at'
>;

type MessageRow = Pick<
  Selectable<DatabaseSchema['messages']>,
  'id' | 'conversation_id' | 'seq' | 'sender' | 'client_message_id' | 'body' | 'created_at'
>;

type VisitorMessageRow = Pick<
  Selectable<DatabaseSchema['messages']>,
  'id' | 'conversation_id' | 'sender' | 'client_message_id'
>;

const correlationIdKeys = [
  'intentId',
  'widgetId',
  'conversationId',
  'visitorSessionId',
  'visitorMessageId',
  'clientMessageId',
] as const;

export async function applyLocalPandaReplyIngressPayloadV1(
  database: DatabaseClient,
  payload: LocalPandaReplyIngressPayloadV1,
  options: ApplyLocalPandaReplyIngressPayloadV1Options = {},
): Promise<ApplyLocalPandaReplyIngressPayloadV1Result> {
  const validatedPayload = validateReplyIngressPayload(payload);

  if (!validatedPayload) {
    return { applied: false, reason: 'invalid_payload' };
  }

  const { correlationIds, idempotencyKey, replyBody } = validatedPayload;

  try {
    return await database.transaction().execute(async (transaction) => {
      const conversation = await findConversationForReply(transaction, correlationIds.conversationId);

      if (!conversation) {
        return { applied: false, reason: 'conversation_not_found' };
      }

      if (
        conversation.widget_id !== correlationIds.widgetId ||
        conversation.visitor_session_id !== correlationIds.visitorSessionId
      ) {
        return { applied: false, reason: 'conversation_correlation_mismatch' };
      }

      const intent = await findPandaDeliveryIntentForReply(transaction, correlationIds.intentId);

      if (!intent) {
        return { applied: false, reason: 'intent_not_found' };
      }

      if (intent.status !== 'claimed' || !intent.claimed_at) {
        return { applied: false, reason: 'intent_not_claimed' };
      }

      if (!intentMatchesCorrelationIds(intent, correlationIds)) {
        return { applied: false, reason: 'intent_correlation_mismatch' };
      }

      const visitorMessage = await findVisitorMessageForReply(transaction, correlationIds.visitorMessageId);

      if (!visitorMessage) {
        return { applied: false, reason: 'visitor_message_not_found' };
      }

      if (visitorMessage.sender !== 'visitor') {
        return { applied: false, reason: 'visitor_message_not_visitor' };
      }

      if (
        visitorMessage.conversation_id !== correlationIds.conversationId ||
        visitorMessage.client_message_id !== correlationIds.clientMessageId
      ) {
        return { applied: false, reason: 'visitor_message_correlation_mismatch' };
      }

      const existingMessage = await findMessageByClientMessageId(transaction, {
        conversationId: correlationIds.conversationId,
        clientMessageId: idempotencyKey,
      });

      if (existingMessage) {
        return replayOrConflict(existingMessage, replyBody);
      }

      const insertedMessage = await insertAgentReplyMessage(transaction, {
        conversationId: correlationIds.conversationId,
        clientMessageId: idempotencyKey,
        body: replyBody,
        now: options.now ?? new Date(),
      });

      if (insertedMessage) {
        return { applied: true, inserted: true, message: insertedMessage };
      }

      const replayedMessage = await findMessageByClientMessageId(transaction, {
        conversationId: correlationIds.conversationId,
        clientMessageId: idempotencyKey,
      });

      if (replayedMessage) {
        return replayOrConflict(replayedMessage, replyBody);
      }

      return { applied: false, reason: 'message_insert_conflict' };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { applied: false, reason: 'message_insert_conflict' };
    }

    throw error;
  }
}

function validateReplyIngressPayload(payload: unknown): ValidatedReplyIngressPayload | null {
  if (!isRecord(payload) || payload.version !== 1 || payload.kind !== 'local-panda-reply-ingress') {
    return null;
  }

  if (!isValidCorrelationIds(payload.correlationIds)) {
    return null;
  }

  const idempotencyKey = payload.idempotencyKey;

  if (typeof idempotencyKey !== 'string' || idempotencyKey !== `local-panda-reply-v1:${payload.correlationIds.intentId}`) {
    return null;
  }

  if (!isRecord(payload.reply)) {
    return null;
  }

  const replyBody = payload.reply.body;
  const replyText = payload.reply.text;

  if (!isNonBlankString(replyBody) || !isNonBlankString(replyText) || replyBody !== replyText) {
    return null;
  }

  return {
    correlationIds: cloneCorrelationIds(payload.correlationIds),
    idempotencyKey,
    replyBody,
  };
}

async function findConversationForReply(
  database: DatabaseExecutor,
  conversationId: string,
): Promise<ConversationRow | null> {
  const row = (await database
    .selectFrom('conversations')
    .select(['id', 'widget_id', 'visitor_session_id'])
    .where('id', '=', conversationId)
    .forUpdate()
    .executeTakeFirst()) as ConversationRow | undefined;

  return row ?? null;
}

async function findPandaDeliveryIntentForReply(
  database: DatabaseExecutor,
  intentId: string,
): Promise<PandaDeliveryIntentRow | null> {
  const row = (await database
    .selectFrom('panda_delivery_intents')
    .select([
      'id',
      'widget_id',
      'conversation_id',
      'visitor_session_id',
      'visitor_message_id',
      'client_message_id',
      'status',
      'claimed_at',
    ])
    .where('id', '=', intentId)
    .forUpdate()
    .executeTakeFirst()) as PandaDeliveryIntentRow | undefined;

  return row ?? null;
}

async function findVisitorMessageForReply(
  database: DatabaseExecutor,
  visitorMessageId: string,
): Promise<VisitorMessageRow | null> {
  const row = (await database
    .selectFrom('messages')
    .select(['id', 'conversation_id', 'sender', 'client_message_id'])
    .where('id', '=', visitorMessageId)
    .executeTakeFirst()) as VisitorMessageRow | undefined;

  return row ?? null;
}

async function findMessageByClientMessageId(
  database: DatabaseExecutor,
  input: { conversationId: string; clientMessageId: string },
): Promise<ConversationMessage | null> {
  const row = (await database
    .selectFrom('messages')
    .select(['id', 'conversation_id', 'seq', 'sender', 'client_message_id', 'body', 'created_at'])
    .where('conversation_id', '=', input.conversationId)
    .where('client_message_id', '=', input.clientMessageId)
    .executeTakeFirst()) as MessageRow | undefined;

  return row ? toConversationMessage(row) : null;
}

async function insertAgentReplyMessage(
  database: DatabaseExecutor,
  input: { conversationId: string; clientMessageId: string; body: string; now: Date },
): Promise<ConversationMessage | null> {
  const seq = await getNextMessageSeq(database, input.conversationId);
  const values = {
    conversation_id: input.conversationId,
    seq,
    sender: 'agent',
    client_message_id: input.clientMessageId,
    body: input.body,
    created_at: input.now,
  } satisfies Insertable<DatabaseSchema['messages']>;

  const row = (await database
    .insertInto('messages')
    .values(values)
    .onConflict((oc) =>
      oc
        .columns(['conversation_id', 'client_message_id'])
        .where('client_message_id', 'is not', null)
        .doNothing(),
    )
    .returning(['id', 'conversation_id', 'seq', 'sender', 'client_message_id', 'body', 'created_at'])
    .executeTakeFirst()) as MessageRow | undefined;

  return row ? toConversationMessage(row) : null;
}

function replayOrConflict(
  message: ConversationMessage,
  replyBody: string,
): { applied: true; inserted: false; message: ConversationMessage } | { applied: false; reason: 'idempotency_conflict' } {
  if (message.sender === 'agent' && message.body === replyBody) {
    return { applied: true, inserted: false, message };
  }

  return { applied: false, reason: 'idempotency_conflict' };
}

function intentMatchesCorrelationIds(
  intent: PandaDeliveryIntentRow,
  correlationIds: LocalPandaReplyIngressPayloadV1['correlationIds'],
): boolean {
  return (
    intent.widget_id === correlationIds.widgetId &&
    intent.conversation_id === correlationIds.conversationId &&
    intent.visitor_session_id === correlationIds.visitorSessionId &&
    intent.visitor_message_id === correlationIds.visitorMessageId &&
    intent.client_message_id === correlationIds.clientMessageId
  );
}

function toConversationMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    seq: row.seq,
    sender: row.sender,
    clientMessageId: row.client_message_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

function isValidCorrelationIds(value: unknown): value is LocalPandaReplyIngressPayloadV1['correlationIds'] {
  return isRecord(value) && correlationIdKeys.every((key) => isNonBlankString(value[key]));
}

function cloneCorrelationIds(
  correlationIds: LocalPandaReplyIngressPayloadV1['correlationIds'],
): LocalPandaReplyIngressPayloadV1['correlationIds'] {
  return {
    intentId: correlationIds.intentId,
    widgetId: correlationIds.widgetId,
    conversationId: correlationIds.conversationId,
    visitorSessionId: correlationIds.visitorSessionId,
    visitorMessageId: correlationIds.visitorMessageId,
    clientMessageId: correlationIds.clientMessageId,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === '23505';
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
