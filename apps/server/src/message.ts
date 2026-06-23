import type { Insertable } from 'kysely';

import type { DatabaseClient, DatabaseSchema, MessageSender } from './db.ts';

export type ConversationMessage = {
  id: string;
  conversationId: string;
  seq: number;
  sender: MessageSender;
  clientMessageId: string | null;
  body: string;
  createdAt: Date;
};

type NonVisitorMessageSender = Exclude<MessageSender, 'visitor'>;

export type InsertConversationMessageInput =
  | {
      conversationId: string;
      sender: 'visitor';
      clientMessageId: string;
      body: string;
      now?: Date;
    }
  | {
      conversationId: string;
      sender: NonVisitorMessageSender;
      clientMessageId?: string | null;
      body: string;
      now?: Date;
    };

type MessageSeqRow = {
  seq: number;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  seq: number;
  sender: MessageSender;
  client_message_id: string | null;
  body: string;
  created_at: Date;
};

export async function getNextMessageSeq(database: DatabaseClient, conversationId: string): Promise<number> {
  const lastMessage = (await database
    .selectFrom('messages')
    .select('seq')
    .where('conversation_id', '=', conversationId)
    .orderBy('seq', 'desc')
    .limit(1)
    .executeTakeFirst()) as MessageSeqRow | undefined;

  return (lastMessage?.seq ?? 0) + 1;
}

type VisitorConversationMessageInput = Extract<InsertConversationMessageInput, { sender: 'visitor' }>;

export type InsertVisitorConversationMessageResult = {
  inserted: boolean;
  message: ConversationMessage;
};

export async function insertConversationMessage(
  database: DatabaseClient,
  input: InsertConversationMessageInput,
): Promise<ConversationMessage> {
  if (input.sender === 'visitor') {
    const result = await insertVisitorConversationMessage(database, input);

    return result.message;
  }

  return insertNewConversationMessage(database, input);
}

export async function insertVisitorConversationMessage(
  database: DatabaseClient,
  input: VisitorConversationMessageInput,
): Promise<InsertVisitorConversationMessageResult> {
  const existingMessage = await findVisitorMessageByClientMessageId(database, {
    conversationId: input.conversationId,
    clientMessageId: input.clientMessageId,
  });

  if (existingMessage) {
    return { inserted: false, message: existingMessage };
  }

  try {
    const message = await insertNewConversationMessage(database, input);

    return { inserted: true, message };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const retryExistingMessage = await findVisitorMessageByClientMessageId(database, {
        conversationId: input.conversationId,
        clientMessageId: input.clientMessageId,
      });

      if (retryExistingMessage) {
        return { inserted: false, message: retryExistingMessage };
      }
    }

    throw error;
  }
}

async function insertNewConversationMessage(
  database: DatabaseClient,
  input: InsertConversationMessageInput,
): Promise<ConversationMessage> {
  const seq = await getNextMessageSeq(database, input.conversationId);
  const createdAt = input.now ?? new Date();
  const values = {
    conversation_id: input.conversationId,
    seq,
    sender: input.sender,
    client_message_id: input.clientMessageId ?? null,
    body: input.body,
    created_at: createdAt,
  } satisfies Insertable<DatabaseSchema['messages']>;

  const row = (await database
    .insertInto('messages')
    .values(values)
    .returning(['id', 'conversation_id', 'seq', 'sender', 'client_message_id', 'body', 'created_at'])
    .executeTakeFirstOrThrow()) as MessageRow;

  return toConversationMessage(row);
}

type FindVisitorMessageByClientMessageIdInput = {
  conversationId: string;
  clientMessageId: string;
};

async function findVisitorMessageByClientMessageId(
  database: DatabaseClient,
  input: FindVisitorMessageByClientMessageIdInput,
): Promise<ConversationMessage | null> {
  const row = (await database
    .selectFrom('messages')
    .select(['id', 'conversation_id', 'seq', 'sender', 'client_message_id', 'body', 'created_at'])
    .where('conversation_id', '=', input.conversationId)
    .where('client_message_id', '=', input.clientMessageId)
    .where('sender', '=', 'visitor')
    .executeTakeFirst()) as MessageRow | undefined;

  return row ? toConversationMessage(row) : null;
}

export type ReadMessagesForConversationOptions = {
  afterSeq?: number;
};

export async function readMessagesForConversation(
  database: DatabaseClient,
  conversationId: string,
  options: ReadMessagesForConversationOptions = {},
): Promise<ConversationMessage[]> {
  let query = database
    .selectFrom('messages')
    .select(['id', 'conversation_id', 'seq', 'sender', 'client_message_id', 'body', 'created_at'])
    .where('conversation_id', '=', conversationId);

  if (options.afterSeq !== undefined) {
    query = query.where('seq', '>', options.afterSeq);
  }

  const rows = (await query.orderBy('seq', 'asc').execute()) as MessageRow[];

  return rows.map(toConversationMessage);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
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
