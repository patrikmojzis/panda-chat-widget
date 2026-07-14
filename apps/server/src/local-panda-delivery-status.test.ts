import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import type { DatabaseClient, MessageSender, PandaDeliveryIntentStatus } from './db.ts';
import { runLocalPandaDeliveryStatusCli } from './local-panda-delivery-status-cli.ts';
import {
  readLocalPandaDeliveryStatus,
  type LocalPandaDeliveryStatusIntentSummary,
  type LocalPandaDeliveryStatusMetadata,
  type LocalPandaDeliveryStatusResult,
} from './local-panda-delivery-status.ts';

type StoredPandaDeliveryIntent = {
  id: string;
  widget_id: string;
  conversation_id: string;
  visitor_session_id: string;
  visitor_message_id: string;
  client_message_id: string;
  route_handle_snapshot: string;
  status: PandaDeliveryIntentStatus;
  claimed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type StoredMessage = {
  id: string;
  conversation_id: string;
  seq: number;
  sender: MessageSender;
  client_message_id: string | null;
  body: string;
  created_at: Date;
};

type AggregateCountValue = string | number | bigint;

type CountOverrides = Partial<{
  queued_intent_count: AggregateCountValue;
  claimed_intent_count: AggregateCountValue;
  claimed_unapplied_intent_count: AggregateCountValue;
  applied_local_reply_count: AggregateCountValue;
}>;

type FakeDatabaseOptions = {
  intents?: StoredPandaDeliveryIntent[];
  messages?: StoredMessage[];
  countOverrides?: CountOverrides;
};

type WhereClause = {
  column: string;
  operator: string;
  value: unknown;
};

type WhereArguments = [string, string, unknown] | [(builder: ExpressionBuilder) => unknown];

type OrderClause = {
  column: string;
  direction: string;
};

type SelectLog = {
  table: string;
  selectedColumns: string[];
  joins: string[];
  wheres: WhereClause[];
  orders: OrderClause[];
  forUpdate: boolean;
  skipLocked: boolean;
  limit: number | undefined;
};

type FakeDatabase = {
  database: DatabaseClient;
  intents: StoredPandaDeliveryIntent[];
  messages: StoredMessage[];
  selects: SelectLog[];
  transactions: number;
  inserts: number;
  updates: number;
  deletes: number;
  schemaCalls: number;
};

type AggregateExpressionBuilder = {
  fn: {
    count: <T>(column: string) => AggregateFunctionBuilder;
  };
};

type AggregateFunctionBuilder = {
  filterWhere: (column: string, operator: string, value: unknown) => AggregateFunctionBuilder;
  as: (alias: string) => SelectedAlias;
};

type SelectedAlias = {
  alias: string;
};

type ExpressionBuilder = {
  selectFrom: (table: string) => SubqueryBuilder;
  exists: (subquery: unknown) => string;
  not: (expression: unknown) => unknown;
};

type SubqueryBuilder = {
  select: (columns: string | string[]) => SubqueryBuilder;
  whereRef: (left: string, operator: string, right: string) => SubqueryBuilder;
  where: (column: string, operator: string, value: unknown) => SubqueryBuilder;
};

type JoinBuilder = {
  onRef: (left: string, operator: string, right: string) => JoinBuilder;
};

type SelectQuery = {
  select: (columns: string | string[] | ((builder: AggregateExpressionBuilder) => unknown)) => SelectQuery;
  innerJoin: (table: string, buildJoin?: (join: JoinBuilder) => unknown) => SelectQuery;
  where: (...args: WhereArguments) => SelectQuery;
  orderBy: (column: string, direction: string) => SelectQuery;
  forUpdate: () => SelectQuery;
  skipLocked: () => SelectQuery;
  limit: (count: number) => SelectQuery;
  executeTakeFirst: () => Promise<unknown>;
};

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const OLDER_CREATED_AT = new Date('2025-12-31T23:59:00.000Z');
const NEWER_CREATED_AT = new Date('2026-01-01T00:05:00.000Z');
const CLAIMED_AT = new Date('2026-01-01T00:10:00.000Z');
const OLDER_CLAIMED_AT = new Date('2026-01-01T00:08:00.000Z');
const REPLY_CREATED_AT = new Date('2026-01-01T00:15:00.000Z');
const DELIVERY_STATUS_KIND = 'local-panda-delivery-status';
const DELIVERY_STATUS_MODE = 'local-only-read-only-diagnostics';
const APPLIED_LOCAL_REPLY_EXISTS_SENTINEL = '__applied_local_reply_exists__';
const APPLIED_LOCAL_REPLY_NOT_EXISTS_SENTINEL = '__applied_local_reply_not_exists__';
const statusSource = await readFile(new URL('./local-panda-delivery-status.ts', import.meta.url), 'utf8');
const statusCliSource = await readFile(new URL('./local-panda-delivery-status-cli.ts', import.meta.url), 'utf8');
const appSource = await readFile(new URL('./app.ts', import.meta.url), 'utf8');
const visitorMessageSource = await readFile(new URL('./visitor-message.ts', import.meta.url), 'utf8');
const serverPackageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8');
const readmeSource = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
const consoleSource = await readSourceTree(new URL('../../console/src/', import.meta.url));
const widgetUiSource = await readSourceTree(new URL('../../widget-ui/src/', import.meta.url));

function createFakeDatabase(options: FakeDatabaseOptions = {}): FakeDatabase {
  const intents = [...(options.intents ?? [])];
  const messages = [...(options.messages ?? [])];
  const selects: SelectLog[] = [];
  let transactions = 0;
  let inserts = 0;
  let updates = 0;
  let deletes = 0;
  let schemaCalls = 0;

  function createSelectQuery(table: string): SelectQuery {
    let selectedColumns: string[] = [];
    const joins: string[] = [];
    const wheres: WhereClause[] = [];
    const orders: OrderClause[] = [];
    let forUpdate = false;
    let skipLocked = false;
    let limit: number | undefined;
    let query: SelectQuery;

    query = {
      select: (columns: string | string[] | ((builder: AggregateExpressionBuilder) => unknown)) => {
        selectedColumns = typeof columns === 'function'
          ? toSelectedAliases(columns(createAggregateExpressionBuilder()))
          : Array.isArray(columns)
            ? columns
            : [columns];
        return query;
      },
      innerJoin: (joinTable: string, buildJoin?: (join: JoinBuilder) => unknown) => {
        joins.push(joinTable);
        buildJoin?.(createJoinBuilder());
        return query;
      },
      where: (...args: WhereArguments) => {
        appendWhereClause(wheres, args);
        return query;
      },
      orderBy: (column: string, direction: string) => {
        orders.push({ column, direction });
        return query;
      },
      forUpdate: () => {
        forUpdate = true;
        return query;
      },
      skipLocked: () => {
        skipLocked = true;
        return query;
      },
      limit: (count: number) => {
        limit = count;
        return query;
      },
      executeTakeFirst: async () => {
        selects.push({
          table,
          selectedColumns: [...selectedColumns],
          joins: [...joins],
          wheres: wheres.map((where) => ({ ...where })),
          orders: orders.map((order) => ({ ...order })),
          forUpdate,
          skipLocked,
          limit,
        });

        if (table !== 'panda_delivery_intents') {
          throw new Error(`Unexpected select table ${table}`);
        }

        if (selectedColumns.includes('queued_intent_count') || selectedColumns.includes('claimed_intent_count')) {
          return {
            queued_intent_count:
              options.countOverrides?.queued_intent_count ?? intents.filter((intent) => intent.status === 'queued').length,
            claimed_intent_count:
              options.countOverrides?.claimed_intent_count ?? intents.filter((intent) => intent.status === 'claimed').length,
          };
        }

        if (selectedColumns.includes('claimed_unapplied_intent_count')) {
          return {
            claimed_unapplied_intent_count:
              options.countOverrides?.claimed_unapplied_intent_count ??
              intents.filter((intent) => matchesWhereClauses(intent, wheres, messages)).length,
          };
        }

        if (selectedColumns.includes('applied_local_reply_count')) {
          return {
            applied_local_reply_count:
              options.countOverrides?.applied_local_reply_count ?? countAppliedLocalReplyRows(intents, messages),
          };
        }

        const rows = sortRows(intents.filter((intent) => matchesWhereClauses(intent, wheres, messages)), orders);
        return limit === undefined ? rows[0] : rows.slice(0, limit)[0];
      },
    };

    return query;
  }

  const fake: FakeDatabase = {
    database: undefined as unknown as DatabaseClient,
    intents,
    messages,
    selects,
    get transactions() {
      return transactions;
    },
    get inserts() {
      return inserts;
    },
    get updates() {
      return updates;
    },
    get deletes() {
      return deletes;
    },
    get schemaCalls() {
      return schemaCalls;
    },
  };

  fake.database = {
    selectFrom: createSelectQuery,
    insertInto: () => {
      inserts += 1;
      throw new Error('unexpected insert in read-only delivery status');
    },
    updateTable: () => {
      updates += 1;
      throw new Error('unexpected update in read-only delivery status');
    },
    deleteFrom: () => {
      deletes += 1;
      throw new Error('unexpected delete in read-only delivery status');
    },
    transaction: () => {
      transactions += 1;
      throw new Error('unexpected transaction in read-only delivery status');
    },
    get schema() {
      schemaCalls += 1;
      throw new Error('unexpected schema access in read-only delivery status');
    },
  } as unknown as DatabaseClient;

  return fake;
}

test('readLocalPandaDeliveryStatus returns zero-work diagnostics', async () => {
  const fake = createFakeDatabase();

  assert.deepEqual(await readLocalPandaDeliveryStatus(fake.database), {
    ...deliveryStatusBase(),
    queuedIntentCount: 0,
    oldestQueuedIntent: null,
    claimedIntentCount: 0,
    claimedUnappliedIntentCount: 0,
    oldestClaimedUnappliedIntent: null,
    appliedLocalReplyCount: 0,
    nextLocalReplyCandidate: null,
  });
  assertReadOnlyDatabaseUse(fake);
});

test('readLocalPandaDeliveryStatus reports the oldest queued candidate without mutating it', async () => {
  const oldestQueued = intentRow({ id: 'intent-old', created_at: OLDER_CREATED_AT });
  const newerQueued = intentRow({ id: 'intent-new', created_at: NEWER_CREATED_AT });
  const fake = createFakeDatabase({ intents: [newerQueued, oldestQueued] });

  const first = await readLocalPandaDeliveryStatus(fake.database);
  const second = await readLocalPandaDeliveryStatus(fake.database);

  assert.equal(first.queuedIntentCount, 2);
  assert.deepEqual(first.oldestQueuedIntent, intentSummary(oldestQueued));
  assert.deepEqual(first.nextLocalReplyCandidate, intentSummary(oldestQueued));
  assert.deepEqual(second, first);
  assert.deepEqual(
    fake.intents.map((intent) => ({ id: intent.id, status: intent.status, claimed_at: intent.claimed_at })),
    [
      { id: 'intent-new', status: 'queued', claimed_at: null },
      { id: 'intent-old', status: 'queued', claimed_at: null },
    ],
  );
  assert.equal(typeof first.oldestQueuedIntent?.createdAt, 'string');
  assert.equal(first.oldestQueuedIntent?.claimedAt, null);
  assertReadOnlyDatabaseUse(fake);
});

test('readLocalPandaDeliveryStatus prefers the oldest claimed-unapplied candidate before queued work', async () => {
  const queued = intentRow({ id: 'intent-queued', created_at: OLDER_CREATED_AT });
  const newerClaimed = claimedIntentRow({ id: 'intent-claimed-newer', claimed_at: CLAIMED_AT, created_at: CREATED_AT });
  const oldestClaimed = claimedIntentRow({
    id: 'intent-claimed-oldest',
    claimed_at: OLDER_CLAIMED_AT,
    created_at: NEWER_CREATED_AT,
  });
  const fake = createFakeDatabase({ intents: [queued, newerClaimed, oldestClaimed] });

  const result = await readLocalPandaDeliveryStatus(fake.database);

  assert.equal(result.queuedIntentCount, 1);
  assert.equal(result.claimedIntentCount, 2);
  assert.equal(result.claimedUnappliedIntentCount, 2);
  assert.deepEqual(result.oldestQueuedIntent, intentSummary(queued));
  assert.deepEqual(result.oldestClaimedUnappliedIntent, intentSummary(oldestClaimed));
  assert.deepEqual(result.nextLocalReplyCandidate, intentSummary(oldestClaimed));
  assert.equal(typeof result.oldestClaimedUnappliedIntent?.createdAt, 'string');
  assert.equal(result.oldestClaimedUnappliedIntent?.claimedAt, OLDER_CLAIMED_AT.toISOString());
  assertReadOnlyDatabaseUse(fake);
});

test('readLocalPandaDeliveryStatus counts same-conversation agent local replies as applied and excludes them as candidates', async () => {
  const appliedIntent = claimedIntentRow({ id: 'intent-applied' });
  const queuedIntent = intentRow({ id: 'intent-queued', created_at: NEWER_CREATED_AT });
  const fake = createFakeDatabase({
    intents: [appliedIntent, queuedIntent],
    messages: [localReplyMessageForIntent(appliedIntent)],
  });

  const result = await readLocalPandaDeliveryStatus(fake.database);

  assert.equal(result.claimedIntentCount, 1);
  assert.equal(result.claimedUnappliedIntentCount, 0);
  assert.equal(result.appliedLocalReplyCount, 1);
  assert.equal(result.oldestClaimedUnappliedIntent, null);
  assert.deepEqual(result.nextLocalReplyCandidate, intentSummary(queuedIntent));
  assertReadOnlyDatabaseUse(fake);
});

test('readLocalPandaDeliveryStatus does not count or exclude wrong-conversation or non-agent idempotency rows', async () => {
  const cases: Array<{ name: string; message: StoredMessage }> = [
    {
      name: 'wrong conversation',
      message: localReplyMessageForIntent(claimedIntentRow(), { conversation_id: 'other-conversation' }),
    },
    {
      name: 'non-agent',
      message: localReplyMessageForIntent(claimedIntentRow(), { sender: 'visitor' }),
    },
  ];

  for (const testCase of cases) {
    const claimedIntent = claimedIntentRow();
    const fake = createFakeDatabase({ intents: [claimedIntent], messages: [testCase.message] });

    const result = await readLocalPandaDeliveryStatus(fake.database);

    assert.equal(result.appliedLocalReplyCount, 0, testCase.name);
    assert.equal(result.claimedUnappliedIntentCount, 1, testCase.name);
    assert.deepEqual(result.oldestClaimedUnappliedIntent, intentSummary(claimedIntent), testCase.name);
    assert.deepEqual(result.nextLocalReplyCandidate, intentSummary(claimedIntent), testCase.name);
    assertReadOnlyDatabaseUse(fake);
  }
});

test('readLocalPandaDeliveryStatus normalizes string and bigint aggregate counts to JSON numbers', async () => {
  const fake = createFakeDatabase({
    countOverrides: {
      queued_intent_count: '2',
      claimed_intent_count: 3n,
      claimed_unapplied_intent_count: '4',
      applied_local_reply_count: 5n,
    },
  });

  const result = await readLocalPandaDeliveryStatus(fake.database);
  const parsed = JSON.parse(JSON.stringify(result)) as LocalPandaDeliveryStatusResult;

  assert.deepEqual(
    {
      queuedIntentCount: result.queuedIntentCount,
      claimedIntentCount: result.claimedIntentCount,
      claimedUnappliedIntentCount: result.claimedUnappliedIntentCount,
      appliedLocalReplyCount: result.appliedLocalReplyCount,
    },
    {
      queuedIntentCount: 2,
      claimedIntentCount: 3,
      claimedUnappliedIntentCount: 4,
      appliedLocalReplyCount: 5,
    },
  );
  assert.equal(typeof parsed.queuedIntentCount, 'number');
  assert.equal(typeof parsed.claimedIntentCount, 'number');
  assert.equal(typeof parsed.claimedUnappliedIntentCount, 'number');
  assert.equal(typeof parsed.appliedLocalReplyCount, 'number');
  assertReadOnlyDatabaseUse(fake);
});

test('runLocalPandaDeliveryStatusCli prints JSON and closes the database on success', async () => {
  const result = await readLocalPandaDeliveryStatus(createFakeDatabase().database);
  const client = {} as DatabaseClient;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  let closedClient: DatabaseClient | undefined;
  let openedUrl: string | undefined;

  await runLocalPandaDeliveryStatusCli({
    loadDatabaseConfig: () => ({ url: 'postgresql://example.local/widget' }),
    createDatabase: (config) => {
      openedUrl = config.url;
      return client;
    },
    readLocalPandaDeliveryStatus: async (database) => {
      assert.equal(database, client);
      return result;
    },
    closeDatabase: async (database) => {
      closedClient = database;
    },
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
    setExitCode: (exitCode) => exitCodes.push(exitCode),
  });

  assert.equal(openedUrl, 'postgresql://example.local/widget');
  assert.deepEqual(JSON.parse(stdout[0] ?? '{}'), result);
  assert.equal(closedClient, client);
  assert.deepEqual(stderr, []);
  assert.deepEqual(exitCodes, []);
});

test('runLocalPandaDeliveryStatusCli writes safe stderr, exits 1, and closes DB for unexpected errors', async () => {
  const client = {} as DatabaseClient;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  let closed = false;

  await runLocalPandaDeliveryStatusCli({
    loadDatabaseConfig: () => ({ url: 'postgresql://example.local/widget' }),
    createDatabase: () => client,
    readLocalPandaDeliveryStatus: async () => {
      throw new Error('delivery status failed postgresql://user:super-secret@127.0.0.1:5432/widget?token=abc');
    },
    closeDatabase: async (database) => {
      assert.equal(database, client);
      closed = true;
    },
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
    setExitCode: (exitCode) => exitCodes.push(exitCode),
  });

  assert.equal(closed, true);
  assert.deepEqual(stdout, []);
  assert.equal(stderr[0], 'failed to read local Panda delivery status diagnostics\n');
  assert.deepEqual(JSON.parse(stderr[1] ?? '{}'), {
    name: 'Error',
    message: 'delivery status failed postgresql://user:[redacted]@127.0.0.1:5432/widget?token=[redacted]',
  });
  assert.equal(stderr.join('').includes('super-secret'), false);
  assert.equal(stderr.join('').includes('token=abc'), false);
  assert.equal(stderr.join('').includes('\n    at '), false);
  assert.deepEqual(exitCodes, [1]);
});

test('delivery status query predicates match local reply idempotency and queued ordering', () => {
  assert.match(statusSource, /where\('status', '=', 'queued'\)/);
  assert.match(
    statusSource,
    /where\('status', '=', 'queued'\)[\s\S]*orderBy\('created_at', 'asc'\)[\s\S]*orderBy\('id', 'asc'\)/,
  );
  assert.match(statusSource, /where\('status', '=', 'claimed'\)[\s\S]*where\('claimed_at', 'is not', null\)/);
  assert.match(
    statusSource,
    /whereRef\('messages\.conversation_id', '=', 'panda_delivery_intents\.conversation_id'\)/,
  );
  assert.match(statusSource, /where\('messages\.sender', '=', 'agent'\)/);
  assert.match(
    statusSource,
    /where\('messages\.client_message_id', '=', sql<string>`'local-panda-reply-v1:' \|\| panda_delivery_intents\.id::text`\)/,
  );
  assert.match(
    statusSource,
    /orderBy\('claimed_at', 'asc'\)[\s\S]*orderBy\('created_at', 'asc'\)[\s\S]*orderBy\('id', 'asc'\)/,
  );
});

test('delivery status wiring stays read-only server CLI-only with no stdin, mutation, network, route, worker, schema, frontend, or status expansion', () => {
  const serverPackage = JSON.parse(serverPackageSource) as { scripts?: Record<string, string> };
  const combinedStatusSource = `${statusSource}\n${statusCliSource}`;
  const combinedFrontendSource = `${consoleSource}\n${widgetUiSource}`;
  const argvMatches = statusCliSource.match(/process\.argv/g) ?? [];

  assert.equal(
    serverPackage.scripts?.['local-panda:delivery-status'],
    'node dist/local-panda-delivery-status-cli.js',
  );
  assert.match(readmeSource, /pnpm --filter @panda-chat-widget\/server local-panda:delivery-status/);
  assert.match(readmeSource, /read-only delivery status preflight/);
  assert.match(readmeSource, /read-only local preflight for `local-panda:reply-manual` and `local-panda:reply-round-trip`/);
  assert.match(statusSource, /locality: 'local-only'/);
  assert.match(statusSource, /network: 'no-network'/);
  assert.match(statusSource, /childProcess: 'not-used'/);
  assert.match(statusSource, /worker: 'not-created'/);
  assert.match(statusSource, /statusLifecycleExpansion: 'not-attempted'/);
  assert.equal(argvMatches.length, 1);
  assert.doesNotMatch(statusCliSource, /readStdin|parseStdin|process\.stdin|for await|stdin_parse/i);
  assert.doesNotMatch(statusCliSource, /parseArgs|argv\.slice|minimist|yargs/i);
  assert.doesNotMatch(
    statusSource,
    /claimNextQueuedPandaDeliveryIntent|prepareNextLocalPandaDispatchDryRun|runNextLocalPandaReplyRoundTrip|runNextLocalPandaReplyManual|applyLocalPandaReplyIngressPayloadV1|buildLocalPandaReplyIngressPayloadV1|insertInto\s*\(|updateTable\s*\(|deleteFrom\s*\(|transaction\s*\(|forUpdate\s*\(|skipLocked\s*\(|\.schema|createTable|alterTable|addColumn|dropTable|dropColumn/i,
  );
  assert.doesNotMatch(
    combinedStatusSource,
    /fetch\s*\(|WebSocket|EventSource|node:http|node:https|node:child_process|child_process|spawn\s*\(|exec\s*\(|setTimeout\s*\(|setInterval\s*\(|Worker\s*\(|dispatcher|daemon|retry|dead-letter|reply-ingestion|runMigrations|migrate\s*\(|status:\s*'sent'|status:\s*'delivered'|status:\s*'failed'|status:\s*'replied'|sent_at|delivered_at|failed_at|replied_at/i,
  );
  assert.doesNotMatch(
    combinedStatusSource,
    /panda\s+(?:a2a|send|gateway)|gateway\s+(?:url|token|request|response|dispatch)/i,
  );
  assert.doesNotMatch(
    appSource,
    /local-panda-delivery-status|readLocalPandaDeliveryStatus|runLocalPandaDeliveryStatusCli|LocalPandaDeliveryStatusResult/,
  );
  assert.doesNotMatch(
    visitorMessageSource,
    /local-panda-delivery-status|readLocalPandaDeliveryStatus|runLocalPandaDeliveryStatusCli|LocalPandaDeliveryStatusResult/,
  );
  assert.doesNotMatch(
    combinedFrontendSource,
    /local-panda-delivery-status|readLocalPandaDeliveryStatus|runLocalPandaDeliveryStatusCli|LocalPandaDeliveryStatusResult/,
  );
});

function assertReadOnlyDatabaseUse(fake: FakeDatabase): void {
  assert.equal(fake.transactions, 0);
  assert.equal(fake.inserts, 0);
  assert.equal(fake.updates, 0);
  assert.equal(fake.deletes, 0);
  assert.equal(fake.schemaCalls, 0);
  assert.ok(fake.selects.length > 0);

  for (const select of fake.selects) {
    assert.equal(select.forUpdate, false);
    assert.equal(select.skipLocked, false);
  }
}

function deliveryStatusBase(): Pick<LocalPandaDeliveryStatusResult, 'kind' | 'mode' | 'metadata'> {
  return {
    kind: DELIVERY_STATUS_KIND,
    mode: DELIVERY_STATUS_MODE,
    metadata: expectedMetadata(),
  };
}

function expectedMetadata(): LocalPandaDeliveryStatusMetadata {
  return {
    locality: 'local-only',
    input: 'no-stdin',
    arguments: 'no-arguments',
    readOnly: 'read-only',
    databaseAccess: 'select-only',
    network: 'no-network',
    pandaCall: 'not-attempted',
    gatewayCall: 'not-attempted',
    externalCliCall: 'not-attempted',
    childProcess: 'not-used',
    publicRoute: 'not-created',
    worker: 'not-created',
    schema: 'not-created-or-migrated',
    frontendExposure: 'not-created',
    stateMutation: 'no-state-mutation',
    statusLifecycleExpansion: 'not-attempted',
  };
}

function intentRow(values: Partial<StoredPandaDeliveryIntent> = {}): StoredPandaDeliveryIntent {
  return {
    id: 'intent-1',
    widget_id: 'widget-1',
    conversation_id: 'conversation-1',
    visitor_session_id: 'visitor-session-1',
    visitor_message_id: 'visitor-message-1',
    client_message_id: 'client-message-1',
    route_handle_snapshot: 'panda:local/demo',
    status: 'queued',
    claimed_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...values,
  };
}

function claimedIntentRow(values: Partial<StoredPandaDeliveryIntent> = {}): StoredPandaDeliveryIntent {
  return intentRow({
    status: 'claimed',
    claimed_at: CLAIMED_AT,
    ...values,
  });
}

function intentSummary(intent: StoredPandaDeliveryIntent): LocalPandaDeliveryStatusIntentSummary {
  return {
    id: intent.id,
    widgetId: intent.widget_id,
    conversationId: intent.conversation_id,
    visitorSessionId: intent.visitor_session_id,
    visitorMessageId: intent.visitor_message_id,
    clientMessageId: intent.client_message_id,
    routeHandleSnapshot: intent.route_handle_snapshot,
    status: intent.status,
    createdAt: intent.created_at.toISOString(),
    claimedAt: intent.claimed_at ? intent.claimed_at.toISOString() : null,
  };
}

function localReplyMessageForIntent(
  intent: Pick<StoredPandaDeliveryIntent, 'id' | 'conversation_id'>,
  overrides: Partial<StoredMessage> = {},
): StoredMessage {
  return {
    id: `reply-${intent.id}`,
    conversation_id: intent.conversation_id,
    seq: 2,
    sender: 'agent',
    client_message_id: localReplyClientMessageId(intent.id),
    body: 'Local Panda reply body should not appear in status output.',
    created_at: REPLY_CREATED_AT,
    ...overrides,
  };
}

function appendWhereClause(wheres: WhereClause[], args: WhereArguments): void {
  if (args.length === 1) {
    const buildExpression = args[0];
    const expression = buildExpression(createExpressionBuilder());

    if (expression === APPLIED_LOCAL_REPLY_NOT_EXISTS_SENTINEL) {
      wheres.push({ column: APPLIED_LOCAL_REPLY_NOT_EXISTS_SENTINEL, operator: '=', value: true });
      return;
    }

    wheres.push({ column: '__expression__', operator: '=', value: expression });
    return;
  }

  wheres.push({ column: args[0], operator: args[1], value: args[2] });
}

function createAggregateExpressionBuilder(): AggregateExpressionBuilder {
  return {
    fn: {
      count: () => createAggregateFunctionBuilder(),
    },
  };
}

function createAggregateFunctionBuilder(): AggregateFunctionBuilder {
  let builder: AggregateFunctionBuilder;

  builder = {
    filterWhere: () => builder,
    as: (alias: string) => ({ alias }),
  };

  return builder;
}

function createExpressionBuilder(): ExpressionBuilder {
  return {
    selectFrom: () => createSubqueryBuilder(),
    exists: () => APPLIED_LOCAL_REPLY_EXISTS_SENTINEL,
    not: (expression: unknown) =>
      expression === APPLIED_LOCAL_REPLY_EXISTS_SENTINEL ? APPLIED_LOCAL_REPLY_NOT_EXISTS_SENTINEL : { not: expression },
  };
}

function createSubqueryBuilder(): SubqueryBuilder {
  let builder: SubqueryBuilder;

  builder = {
    select: () => builder,
    whereRef: () => builder,
    where: () => builder,
  };

  return builder;
}

function createJoinBuilder(): JoinBuilder {
  let builder: JoinBuilder;

  builder = {
    onRef: () => builder,
  };

  return builder;
}

function toSelectedAliases(selected: unknown): string[] {
  const values = Array.isArray(selected) ? selected : [selected];

  return values.map((value) => (isSelectedAlias(value) ? value.alias : String(value)));
}

function isSelectedAlias(value: unknown): value is SelectedAlias {
  return typeof value === 'object' && value !== null && 'alias' in value && typeof value.alias === 'string';
}

function matchesWhereClauses(
  intent: StoredPandaDeliveryIntent,
  wheres: WhereClause[],
  messages: StoredMessage[],
): boolean {
  return wheres.every((where) => {
    if (where.column === 'status') {
      return intent.status === where.value;
    }

    if (where.column === 'claimed_at' && where.operator === 'is not' && where.value === null) {
      return intent.claimed_at !== null;
    }

    if (where.column === APPLIED_LOCAL_REPLY_NOT_EXISTS_SENTINEL) {
      return !hasAppliedLocalReply(intent, messages);
    }

    return true;
  });
}

function hasAppliedLocalReply(
  intent: Pick<StoredPandaDeliveryIntent, 'id' | 'conversation_id'>,
  messages: StoredMessage[],
): boolean {
  return messages.some(
    (message) =>
      message.conversation_id === intent.conversation_id &&
      message.sender === 'agent' &&
      message.client_message_id === localReplyClientMessageId(intent.id),
  );
}

function countAppliedLocalReplyRows(intents: StoredPandaDeliveryIntent[], messages: StoredMessage[]): number {
  return intents.reduce(
    (count, intent) =>
      count +
      messages.filter(
        (message) =>
          message.conversation_id === intent.conversation_id &&
          message.sender === 'agent' &&
          message.client_message_id === localReplyClientMessageId(intent.id),
      ).length,
    0,
  );
}

function localReplyClientMessageId(intentId: string): string {
  return `local-panda-reply-v1:${intentId}`;
}

function sortRows(rows: StoredPandaDeliveryIntent[], orders: OrderClause[]): StoredPandaDeliveryIntent[] {
  return [...rows].sort((left, right) => {
    for (const order of orders) {
      const comparison = compareValues(valueForOrder(left, order.column), valueForOrder(right, order.column), order.column);

      if (comparison !== 0) {
        return order.direction === 'desc' ? -comparison : comparison;
      }
    }

    return 0;
  });
}

function valueForOrder(intent: StoredPandaDeliveryIntent, column: string): Date | string | null {
  switch (column) {
    case 'claimed_at':
      return intent.claimed_at;
    case 'created_at':
      return intent.created_at;
    case 'id':
      return intent.id;
    default:
      return null;
  }
}

function compareValues(left: Date | string | null, right: Date | string | null, column: string): number {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  if (column === 'created_at' || column === 'claimed_at') {
    const leftTime = left instanceof Date ? left.getTime() : new Date(left).getTime();
    const rightTime = right instanceof Date ? right.getTime() : new Date(right).getTime();
    return leftTime - rightTime;
  }

  return String(left).localeCompare(String(right));
}

async function readSourceTree(root: URL): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  const chunks: string[] = [];

  for (const entry of entries) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), root);

    if (entry.isDirectory()) {
      chunks.push(await readSourceTree(child));
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      chunks.push(await readFile(child, 'utf8'));
    }
  }

  return chunks.join('\n');
}
