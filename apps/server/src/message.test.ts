import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { DatabaseClient, MessageSender } from './db.ts';
import {
  getNextMessageSeq,
  insertConversationMessage,
  insertVisitorConversationMessage,
  readMessagesForConversation,
} from './message.ts';

type StoredMessage = {
  id: string;
  conversation_id: string;
  seq: number;
  sender: MessageSender;
  client_message_id: string | null;
  body: string;
  created_at: Date;
};

type MessageInsertValues = Omit<StoredMessage, 'id'>;

type MessageInsertConflictTarget = {
  columns: string[];
  where: { column: string; operator: string; value: null } | null;
};

type FakeDatabaseOptions = {
  visitorInsertRaceMessage?: StoredMessage;
};

type FakeDatabase = {
  database: DatabaseClient;
  messageSelects: Array<{ conversationId: string; order: 'asc' | 'desc'; limit?: number; afterSeq?: number }>;
  messageClientMessageLookups: Array<{ conversationId: string; clientMessageId: string }>;
  messageInserts: MessageInsertValues[];
  messageInsertConflictTargets: MessageInsertConflictTarget[];
  messageInsertConflictDoNothingCount: number;
  messages: StoredMessage[];
};

const FIRST_CREATED_AT = new Date('2026-01-01T00:00:00Z');
const SECOND_CREATED_AT = new Date('2026-01-01T00:01:00Z');
const messageSource = await readFile(new URL('./message.ts', import.meta.url), 'utf8');

function createFakeDatabase(initialMessages: StoredMessage[] = [], options: FakeDatabaseOptions = {}): FakeDatabase {
  const messageSelects: Array<{ conversationId: string; order: 'asc' | 'desc'; limit?: number; afterSeq?: number }> = [];
  const messageClientMessageLookups: Array<{ conversationId: string; clientMessageId: string }> = [];
  const messageInserts: MessageInsertValues[] = [];
  const messageInsertConflictTargets: MessageInsertConflictTarget[] = [];
  let messageInsertConflictDoNothingCount = 0;
  let visitorInsertRaceMessage = options.visitorInsertRaceMessage;
  const messages = [...initialMessages];

  function createMessageSelectQuery(tableName: string) {
    assert.equal(tableName, 'messages');
    let conversationId: string | undefined;
    let clientMessageId: string | undefined;
    let sender: MessageSender | undefined;
    let order: 'asc' | 'desc' = 'asc';
    let limitCount: number | undefined;
    let afterSeq: number | undefined;

    const query = {
      select: () => query,
      where: (column: string, operator: string, value: string | number) => {
        if (column === 'conversation_id') {
          assert.equal(operator, '=');
          if (typeof value !== 'string') {
            throw new Error('expected string conversation_id value');
          }

          conversationId = value;
          return query;
        }

        if (column === 'client_message_id') {
          assert.equal(operator, '=');
          if (typeof value !== 'string') {
            throw new Error('expected string client_message_id value');
          }

          clientMessageId = value;
          return query;
        }

        if (column === 'sender') {
          assert.equal(operator, '=');
          assert.equal(value, 'visitor');
          sender = 'visitor';
          return query;
        }

        assert.equal(column, 'seq');
        assert.equal(operator, '>');
        if (typeof value !== 'number') {
          throw new Error('expected number seq value');
        }

        afterSeq = value;
        return query;
      },
      orderBy: (column: string, direction: 'asc' | 'desc') => {
        assert.equal(column, 'seq');
        order = direction;
        return query;
      },
      limit: (limit: number) => {
        limitCount = limit;
        return query;
      },
      executeTakeFirst: async () => {
        if (clientMessageId !== undefined) {
          if (!conversationId || sender !== 'visitor') {
            throw new Error('missing visitor message replay lookup filters');
          }

          messageClientMessageLookups.push({ conversationId, clientMessageId });
          return messages.find(
            (message) =>
              message.conversation_id === conversationId &&
              message.client_message_id === clientMessageId &&
              message.sender === 'visitor',
          );
        }

        const rows = selectRows(conversationId, order, limitCount, afterSeq);
        return rows[0];
      },
      execute: async () => selectRows(conversationId, order, limitCount, afterSeq),
    };

    return query;
  }

  function createMessageInsertQuery(tableName: string) {
    assert.equal(tableName, 'messages');
    let pendingValues: MessageInsertValues | undefined;
    let conflictTarget: MessageInsertConflictTarget | null = null;
    let doNothingOnConflict = false;

    const conflictBuilder = {
      where: (column: string, operator: string, value: null) => {
        if (!conflictTarget) {
          throw new Error('missing conflict target before where');
        }

        conflictTarget.where = { column, operator, value };

        return conflictBuilder;
      },
      doNothing: () => {
        doNothingOnConflict = true;
        messageInsertConflictDoNothingCount += 1;

        return query;
      },
    };

    const query = {
      values: (values: MessageInsertValues) => {
        pendingValues = values;
        return query;
      },
      onConflict: (
        buildConflict: (builder: {
          columns: (columns: string[]) => typeof conflictBuilder;
        }) => unknown,
      ) => {
        buildConflict({
          columns: (columns: string[]) => {
            conflictTarget = { columns, where: null };
            messageInsertConflictTargets.push(conflictTarget);

            return conflictBuilder;
          },
        });

        return query;
      },
      returning: () => query,
      executeTakeFirst: async () => executeInsert(),
      executeTakeFirstOrThrow: async () => {
        const row = await executeInsert();

        if (!row) {
          throw new Error('message insert returned no row');
        }

        return row;
      },
    };

    function executeInsert(): StoredMessage | undefined {
      if (!pendingValues) {
        throw new Error('missing message insert values');
      }

      assert.equal(pendingValues.seq > 0, true);

      if (
        visitorInsertRaceMessage &&
        pendingValues.sender === 'visitor' &&
        visitorInsertRaceMessage.conversation_id === pendingValues.conversation_id &&
        visitorInsertRaceMessage.client_message_id === pendingValues.client_message_id
      ) {
        messages.push(visitorInsertRaceMessage);
        visitorInsertRaceMessage = undefined;
      }

      const duplicateVisitorMessage = pendingValues.sender === 'visitor'
        ? messages.find(
            (message) =>
              message.conversation_id === pendingValues?.conversation_id &&
              message.client_message_id === pendingValues?.client_message_id &&
              message.client_message_id !== null,
          )
        : undefined;

      if (duplicateVisitorMessage) {
        assert.deepEqual(conflictTarget, {
          columns: ['conversation_id', 'client_message_id'],
          where: { column: 'client_message_id', operator: 'is not', value: null },
        });
        assert.equal(doNothingOnConflict, true);

        return undefined;
      }

      messageInserts.push(pendingValues);
      const newMessage = {
        id: `message-${messages.length + 1}`,
        ...pendingValues,
      };
      messages.push(newMessage);

      return newMessage;
    }

    return query;
  }

  function selectRows(
    conversationId: string | undefined,
    order: 'asc' | 'desc',
    limitCount: number | undefined,
    afterSeq: number | undefined,
  ) {
    if (!conversationId) {
      throw new Error('missing conversation_id filter');
    }

    messageSelects.push({
      conversationId,
      order,
      ...(limitCount === undefined ? {} : { limit: limitCount }),
      ...(afterSeq === undefined ? {} : { afterSeq }),
    });
    const sortedRows = messages
      .filter((message) => message.conversation_id === conversationId)
      .filter((message) => afterSeq === undefined || message.seq > afterSeq)
      .sort((left, right) => (order === 'asc' ? left.seq - right.seq : right.seq - left.seq));

    return limitCount === undefined ? sortedRows : sortedRows.slice(0, limitCount);
  }

  const database = {
    insertInto: createMessageInsertQuery,
    selectFrom: createMessageSelectQuery,
  } as unknown as DatabaseClient;

  return {
    database,
    messageSelects,
    messageClientMessageLookups,
    messageInserts,
    messageInsertConflictTargets,
    get messageInsertConflictDoNothingCount() {
      return messageInsertConflictDoNothingCount;
    },
    messages,
  };
}

test('getNextMessageSeq starts at 1 and increments from the highest conversation seq', async () => {
  const fake = createFakeDatabase([
    messageRow({ id: 'message-2', conversationId: 'conversation-a', seq: 2 }),
    messageRow({ id: 'message-1', conversationId: 'conversation-a', seq: 1 }),
    messageRow({ id: 'other-message-7', conversationId: 'conversation-b', seq: 7 }),
  ]);

  assert.equal(await getNextMessageSeq(fake.database, 'conversation-a'), 3);
  assert.equal(await getNextMessageSeq(fake.database, 'conversation-missing'), 1);
  assert.deepEqual(fake.messageSelects, [
    { conversationId: 'conversation-a', order: 'desc', limit: 1 },
    { conversationId: 'conversation-missing', order: 'desc', limit: 1 },
  ]);
});

test('insertConversationMessage assigns stable increasing seq values per conversation', async () => {
  const fake = createFakeDatabase();

  const firstMessage = await insertConversationMessage(fake.database, {
    conversationId: 'conversation-a',
    sender: 'visitor',
    clientMessageId: 'client-message-1',
    body: 'Hello',
    now: FIRST_CREATED_AT,
  });
  const secondMessage = await insertConversationMessage(fake.database, {
    conversationId: 'conversation-a',
    sender: 'visitor',
    clientMessageId: 'client-message-2',
    body: 'I need help',
    now: SECOND_CREATED_AT,
  });
  const otherConversationMessage = await insertConversationMessage(fake.database, {
    conversationId: 'conversation-b',
    sender: 'agent',
    body: 'Fresh conversation',
    now: FIRST_CREATED_AT,
  });

  assert.deepEqual(firstMessage, {
    id: 'message-1',
    conversationId: 'conversation-a',
    seq: 1,
    sender: 'visitor',
    clientMessageId: 'client-message-1',
    body: 'Hello',
    createdAt: FIRST_CREATED_AT,
  });
  assert.deepEqual(secondMessage, {
    id: 'message-2',
    conversationId: 'conversation-a',
    seq: 2,
    sender: 'visitor',
    clientMessageId: 'client-message-2',
    body: 'I need help',
    createdAt: SECOND_CREATED_AT,
  });
  assert.deepEqual(otherConversationMessage, {
    id: 'message-3',
    conversationId: 'conversation-b',
    seq: 1,
    sender: 'agent',
    clientMessageId: null,
    body: 'Fresh conversation',
    createdAt: FIRST_CREATED_AT,
  });
  assert.deepEqual(
    fake.messageInserts.map((values) => ({
      conversation_id: values.conversation_id,
      seq: values.seq,
      sender: values.sender,
      client_message_id: values.client_message_id,
      body: values.body,
    })),
    [
      {
        conversation_id: 'conversation-a',
        seq: 1,
        sender: 'visitor',
        client_message_id: 'client-message-1',
        body: 'Hello',
      },
      {
        conversation_id: 'conversation-a',
        seq: 2,
        sender: 'visitor',
        client_message_id: 'client-message-2',
        body: 'I need help',
      },
      {
        conversation_id: 'conversation-b',
        seq: 1,
        sender: 'agent',
        client_message_id: null,
        body: 'Fresh conversation',
      },
    ],
  );
});


test('insertConversationMessage replays an existing visitor message without allocating seq', async () => {
  const fake = createFakeDatabase([
    messageRow({
      id: 'message-1',
      conversationId: 'conversation-a',
      seq: 1,
      clientMessageId: 'client-message-1',
      body: 'Original body',
    }),
  ]);

  const message = await insertConversationMessage(fake.database, {
    conversationId: 'conversation-a',
    sender: 'visitor',
    clientMessageId: 'client-message-1',
    body: 'Conflicting retry body',
    now: SECOND_CREATED_AT,
  });

  assert.deepEqual(message, {
    id: 'message-1',
    conversationId: 'conversation-a',
    seq: 1,
    sender: 'visitor',
    clientMessageId: 'client-message-1',
    body: 'Original body',
    createdAt: FIRST_CREATED_AT,
  });
  assert.deepEqual(fake.messageClientMessageLookups, [
    { conversationId: 'conversation-a', clientMessageId: 'client-message-1' },
  ]);
  assert.deepEqual(fake.messageSelects, []);
  assert.deepEqual(fake.messageInserts, []);
});


test('insertVisitorConversationMessage replays a concurrent duplicate without throwing a unique violation', async () => {
  const fake = createFakeDatabase([], {
    visitorInsertRaceMessage: messageRow({
      id: 'message-race',
      conversationId: 'conversation-a',
      seq: 1,
      clientMessageId: 'client-message-1',
      body: 'Original body',
    }),
  });

  const result = await insertVisitorConversationMessage(fake.database, {
    conversationId: 'conversation-a',
    sender: 'visitor',
    clientMessageId: 'client-message-1',
    body: 'Conflicting retry body',
    now: SECOND_CREATED_AT,
  });

  assert.equal(result.inserted, false);
  assert.deepEqual(result.message, {
    id: 'message-race',
    conversationId: 'conversation-a',
    seq: 1,
    sender: 'visitor',
    clientMessageId: 'client-message-1',
    body: 'Original body',
    createdAt: FIRST_CREATED_AT,
  });
  assert.deepEqual(fake.messageClientMessageLookups, [
    { conversationId: 'conversation-a', clientMessageId: 'client-message-1' },
    { conversationId: 'conversation-a', clientMessageId: 'client-message-1' },
  ]);
  assert.deepEqual(fake.messageSelects, [{ conversationId: 'conversation-a', order: 'desc', limit: 1 }]);
  assert.deepEqual(fake.messageInserts, []);
  assert.deepEqual(fake.messageInsertConflictTargets, [
    {
      columns: ['conversation_id', 'client_message_id'],
      where: { column: 'client_message_id', operator: 'is not', value: null },
    },
  ]);
  assert.equal(fake.messageInsertConflictDoNothingCount, 1);
});

test('insertConversationMessage keeps visitor client message ids scoped to a conversation', async () => {
  const fake = createFakeDatabase([
    messageRow({
      id: 'message-1',
      conversationId: 'conversation-a',
      seq: 1,
      clientMessageId: 'client-message-1',
    }),
  ]);

  const message = await insertConversationMessage(fake.database, {
    conversationId: 'conversation-b',
    sender: 'visitor',
    clientMessageId: 'client-message-1',
    body: 'Same client id in another conversation',
    now: SECOND_CREATED_AT,
  });

  assert.deepEqual(message, {
    id: 'message-2',
    conversationId: 'conversation-b',
    seq: 1,
    sender: 'visitor',
    clientMessageId: 'client-message-1',
    body: 'Same client id in another conversation',
    createdAt: SECOND_CREATED_AT,
  });
  assert.deepEqual(fake.messageClientMessageLookups, [
    { conversationId: 'conversation-b', clientMessageId: 'client-message-1' },
  ]);
  assert.deepEqual(fake.messageSelects, [{ conversationId: 'conversation-b', order: 'desc', limit: 1 }]);
  assert.equal(fake.messageInserts.length, 1);
});


test('insertVisitorConversationMessage reports whether the visitor message was newly inserted', async () => {
  const fake = createFakeDatabase([
    messageRow({
      id: 'message-1',
      conversationId: 'conversation-a',
      seq: 1,
      clientMessageId: 'client-message-1',
      body: 'Original body',
    }),
  ]);

  const replay = await insertVisitorConversationMessage(fake.database, {
    conversationId: 'conversation-a',
    sender: 'visitor',
    clientMessageId: 'client-message-1',
    body: 'Conflicting retry body',
  });
  const inserted = await insertVisitorConversationMessage(fake.database, {
    conversationId: 'conversation-a',
    sender: 'visitor',
    clientMessageId: 'client-message-2',
    body: 'Fresh visitor message',
    now: SECOND_CREATED_AT,
  });

  assert.equal(replay.inserted, false);
  assert.equal(replay.message.body, 'Original body');
  assert.equal(inserted.inserted, true);
  assert.deepEqual(inserted.message, {
    id: 'message-2',
    conversationId: 'conversation-a',
    seq: 2,
    sender: 'visitor',
    clientMessageId: 'client-message-2',
    body: 'Fresh visitor message',
    createdAt: SECOND_CREATED_AT,
  });
  assert.deepEqual(fake.messageClientMessageLookups, [
    { conversationId: 'conversation-a', clientMessageId: 'client-message-1' },
    { conversationId: 'conversation-a', clientMessageId: 'client-message-2' },
  ]);
  assert.deepEqual(fake.messageSelects, [{ conversationId: 'conversation-a', order: 'desc', limit: 1 }]);
  assert.equal(fake.messageInserts.length, 1);
});

test('readMessagesForConversation returns messages in deterministic seq order', async () => {
  const fake = createFakeDatabase([
    messageRow({ id: 'message-3', conversationId: 'conversation-a', seq: 3, body: 'Third' }),
    messageRow({ id: 'other-message-1', conversationId: 'conversation-b', seq: 1, body: 'Other' }),
    messageRow({ id: 'message-1', conversationId: 'conversation-a', seq: 1, body: 'First' }),
    messageRow({ id: 'message-2', conversationId: 'conversation-a', seq: 2, body: 'Second' }),
  ]);

  const messages = await readMessagesForConversation(fake.database, 'conversation-a');

  assert.deepEqual(
    messages.map((message) => ({ id: message.id, seq: message.seq, body: message.body })),
    [
      { id: 'message-1', seq: 1, body: 'First' },
      { id: 'message-2', seq: 2, body: 'Second' },
      { id: 'message-3', seq: 3, body: 'Third' },
    ],
  );
  assert.deepEqual(fake.messageSelects, [{ conversationId: 'conversation-a', order: 'asc' }]);
});

test('readMessagesForConversation can return only messages after a seq', async () => {
  const fake = createFakeDatabase([
    messageRow({ id: 'message-3', conversationId: 'conversation-a', seq: 3, body: 'Third' }),
    messageRow({ id: 'message-1', conversationId: 'conversation-a', seq: 1, body: 'First' }),
    messageRow({ id: 'message-2', conversationId: 'conversation-a', seq: 2, body: 'Second' }),
  ]);

  const messages = await readMessagesForConversation(fake.database, 'conversation-a', { afterSeq: 1 });

  assert.deepEqual(
    messages.map((message) => ({ id: message.id, seq: message.seq, body: message.body })),
    [
      { id: 'message-2', seq: 2, body: 'Second' },
      { id: 'message-3', seq: 3, body: 'Third' },
    ],
  );
  assert.deepEqual(fake.messageSelects, [{ conversationId: 'conversation-a', order: 'asc', afterSeq: 1 }]);
});

test('message seam has no HTTP route, streaming, Gateway/CLI/network, worker, timer, fake reply, or UI behavior', () => {
  assert.match(messageSource, /selectFrom\('messages'\)/);
  assert.match(messageSource, /insertInto\('messages'\)/);
  assert.match(messageSource, /insertVisitorConversationMessage/);
  assert.match(messageSource, /onConflict/);
  assert.match(messageSource, /doNothing/);
  assert.match(messageSource, /where\('client_message_id', '=', input\.clientMessageId\)/);
  assert.match(messageSource, /where\('seq', '>', options\.afterSeq\)/);
  assert.match(messageSource, /orderBy\('seq', 'asc'\)/);
  assert.match(messageSource, /orderBy\('seq', 'desc'\)/);
  assert.doesNotMatch(
    messageSource,
    /Fastify|app\.post|visitor-session|conversation route|23505|isUniqueViolation|EventSource|WebSocket|Gateway|\bCLI\b|fetch|child_process|Worker|localStorage|setTimeout|setInterval|fake/i,
  );
});

type MessageRowInput = {
  id: string;
  conversationId: string;
  seq: number;
  sender?: MessageSender;
  clientMessageId?: string | null;
  body?: string;
  createdAt?: Date;
};

function messageRow(input: MessageRowInput): StoredMessage {
  return {
    id: input.id,
    conversation_id: input.conversationId,
    seq: input.seq,
    sender: input.sender ?? 'visitor',
    client_message_id: input.clientMessageId ?? `client-${input.id}`,
    body: input.body ?? input.id,
    created_at: input.createdAt ?? FIRST_CREATED_AT,
  };
}
