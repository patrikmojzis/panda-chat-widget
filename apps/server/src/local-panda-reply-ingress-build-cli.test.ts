import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import type { LocalPandaDispatchPayloadV1 } from './local-panda-dispatch-payload.ts';
import {
  runLocalPandaReplyIngressBuildCli,
  type LocalPandaReplyIngressBuildCliDependencies,
} from './local-panda-reply-ingress-build-cli.ts';
import type { LocalPandaReplyIngressCorrelationIds } from './local-panda-reply-ingress-payload.ts';

const BUILD_CLI_KIND = 'local-panda-reply-ingress-build';
const BUILD_CLI_MODE = 'local-only-stdin-reply-ingress-build';
const BUILD_CLI_METADATA = {
  locality: 'local-only',
  input: 'stdin-json-object',
  network: 'no-network',
  pandaCall: 'not-attempted',
  gatewayCall: 'not-attempted',
  externalCliCall: 'not-attempted',
  childProcess: 'not-used',
  publicRoute: 'not-created',
  worker: 'not-created',
  statusLifecycleExpansion: 'not-attempted',
  stateMutation: 'no-state-mutation',
  replyIngressApply: 'not-attempted',
  publicFakeReplyReplacement: 'not-attempted',
};
const buildCliSource = await readFile(new URL('./local-panda-reply-ingress-build-cli.ts', import.meta.url), 'utf8');
const appSource = await readFile(new URL('./app.ts', import.meta.url), 'utf8');
const visitorMessageSource = await readFile(new URL('./visitor-message.ts', import.meta.url), 'utf8');
const serverPackageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8');
const readmeSource = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
const consoleSource = await readSourceTree(new URL('../../console/src/', import.meta.url));
const widgetUiSource = await readSourceTree(new URL('../../widget-ui/src/', import.meta.url));

const baseCorrelationIds: LocalPandaReplyIngressCorrelationIds = {
  intentId: 'intent-1',
  widgetId: 'widget-1',
  conversationId: 'conversation-1',
  visitorSessionId: 'visitor-session-1',
  visitorMessageId: 'visitor-message-1',
  clientMessageId: 'client-message-1',
};

test('runLocalPandaReplyIngressBuildCli builds a local-only envelope and v1 idempotency key with the real builder', async () => {
  const dispatchPayload = validDispatchPayload();
  const run = await runBuildCli({
    input: JSON.stringify({
      dispatchPayload,
      reply: { text: '  Hello from the local Panda agent.  ' },
    }),
  });
  const envelope = parseCliJsonObject(run.stdout[0]);

  assertBuildCliBaseEnvelope(envelope);
  assert.equal(envelope.built, true);
  assert.equal(envelope.parsed, true);
  assert.equal(envelope.payload.idempotencyKey, 'local-panda-reply-v1:intent-1');
  assert.deepEqual(envelope, {
    kind: BUILD_CLI_KIND,
    mode: BUILD_CLI_MODE,
    metadata: BUILD_CLI_METADATA,
    built: true,
    parsed: true,
    payload: {
      version: 1,
      kind: 'local-panda-reply-ingress',
      idempotencyKey: 'local-panda-reply-v1:intent-1',
      correlationIds: correlationIds(),
      reply: {
        body: 'Hello from the local Panda agent.',
        text: 'Hello from the local Panda agent.',
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
  });
  assert.equal(run.stdout[0]?.endsWith('\n'), true);
  assert.match(run.stdout[0] ?? '', /\n  "kind": "local-panda-reply-ingress-build"/);
  assert.deepEqual(run.stderr, []);
  assert.deepEqual(run.exitCodes, []);
});

test('runLocalPandaReplyIngressBuildCli rejects stdin parse failures before calling the builder', async () => {
  const cases: Array<{ name: string; input: string; reason: string }> = [
    { name: 'empty stdin', input: '', reason: 'empty_stdin' },
    { name: 'whitespace stdin', input: '   \n\t', reason: 'empty_stdin' },
    { name: 'malformed JSON', input: '{', reason: 'malformed_json' },
    { name: 'null JSON', input: 'null', reason: 'json_value_not_object' },
    { name: 'array JSON', input: '[]', reason: 'json_value_not_object' },
    { name: 'scalar string JSON', input: '"reply"', reason: 'json_value_not_object' },
    { name: 'scalar number JSON', input: '123', reason: 'json_value_not_object' },
    { name: 'scalar boolean JSON', input: 'true', reason: 'json_value_not_object' },
  ];

  for (const testCase of cases) {
    let buildCount = 0;
    const run = await runBuildCli({
      input: testCase.input,
      buildLocalPandaReplyIngressPayloadV1: () => {
        buildCount += 1;
        throw new Error('builder must not be called for parse failures');
      },
    });
    const envelope = parseCliJsonObject(run.stdout[0]);

    assertBuildCliBaseEnvelope(envelope);
    assert.equal(envelope.built, false, testCase.name);
    assert.equal(envelope.parsed, false, testCase.name);
    assert.equal(envelope.failedStep, 'stdin_parse', testCase.name);
    assert.equal(envelope.reason, testCase.reason, testCase.name);
    assert.deepEqual(run.stderr, [], testCase.name);
    assert.deepEqual(run.exitCodes, [1], testCase.name);
    assert.equal(buildCount, 0, testCase.name);
  }
});

test('runLocalPandaReplyIngressBuildCli returns builder-controlled failures for every existing reason', async () => {
  const cases: Array<{
    name: string;
    input: unknown;
    reason: string;
  }> = [
    {
      name: 'invalid dispatch payload',
      input: {
        dispatchPayload: { ...validDispatchPayload(), kind: 'local-panda-reply-ingress' },
        reply: { text: 'Reply text' },
      },
      reason: 'invalid_dispatch_payload',
    },
    {
      name: 'explicit invalid reply correlation',
      input: {
        dispatchPayload: validDispatchPayload(),
        reply: {
          correlationIds: correlationIds({ visitorMessageId: '   ' }),
          text: 'Reply text',
        },
      },
      reason: 'invalid_reply_correlation',
    },
    {
      name: 'explicit reply correlation mismatch',
      input: {
        dispatchPayload: validDispatchPayload(),
        reply: {
          correlationIds: correlationIds({ clientMessageId: 'other-client-message' }),
          text: 'Reply text',
        },
      },
      reason: 'reply_correlation_mismatch',
    },
    {
      name: 'invalid reply text after adapter correlation injection',
      input: {
        dispatchPayload: validDispatchPayload(),
        reply: { text: 123 },
      },
      reason: 'invalid_reply_text',
    },
    {
      name: 'missing reply text after adapter correlation injection',
      input: {
        dispatchPayload: validDispatchPayload(),
        reply: {},
      },
      reason: 'missing_reply_text',
    },
  ];

  for (const testCase of cases) {
    const run = await runBuildCli({ input: JSON.stringify(testCase.input) });
    const envelope = parseCliJsonObject(run.stdout[0]);

    assertBuildCliBaseEnvelope(envelope);
    assert.equal(envelope.built, false, testCase.name);
    assert.equal(envelope.parsed, true, testCase.name);
    assert.equal(envelope.failedStep, 'reply_ingress_build', testCase.name);
    assert.equal(envelope.reason, testCase.reason, testCase.name);
    assert.deepEqual(envelope.buildResult, { built: false, reason: testCase.reason }, testCase.name);
    assert.deepEqual(run.stderr, [], testCase.name);
    assert.deepEqual(run.exitCodes, [], testCase.name);
  }
});

test('runLocalPandaReplyIngressBuildCli preserves explicit reply correlation IDs instead of overwriting mismatches', async () => {
  const run = await runBuildCli({
    input: JSON.stringify({
      dispatchPayload: validDispatchPayload(),
      reply: {
        correlationIds: correlationIds({ intentId: 'other-intent' }),
        text: 'Reply text',
      },
    }),
  });
  const envelope = parseCliJsonObject(run.stdout[0]);

  assertBuildCliBaseEnvelope(envelope);
  assert.equal(envelope.built, false);
  assert.equal(envelope.parsed, true);
  assert.equal(envelope.failedStep, 'reply_ingress_build');
  assert.equal(envelope.reason, 'reply_correlation_mismatch');
  assert.deepEqual(envelope.buildResult, { built: false, reason: 'reply_correlation_mismatch' });
  assert.deepEqual(run.stderr, []);
  assert.deepEqual(run.exitCodes, []);
});

test('runLocalPandaReplyIngressBuildCli preserves non-record replies so the builder controls correlation failures', async () => {
  const cases: Array<{ name: string; reply: unknown }> = [
    { name: 'null reply', reply: null },
    { name: 'array reply', reply: [] },
    { name: 'string reply', reply: 'Reply text' },
  ];

  for (const testCase of cases) {
    const run = await runBuildCli({
      input: JSON.stringify({
        dispatchPayload: validDispatchPayload(),
        reply: testCase.reply,
      }),
    });
    const envelope = parseCliJsonObject(run.stdout[0]);

    assertBuildCliBaseEnvelope(envelope);
    assert.equal(envelope.built, false, testCase.name);
    assert.equal(envelope.parsed, true, testCase.name);
    assert.equal(envelope.failedStep, 'reply_ingress_build', testCase.name);
    assert.equal(envelope.reason, 'invalid_reply_correlation', testCase.name);
    assert.deepEqual(
      envelope.buildResult,
      { built: false, reason: 'invalid_reply_correlation' },
      testCase.name,
    );
    assert.deepEqual(run.stderr, [], testCase.name);
    assert.deepEqual(run.exitCodes, [], testCase.name);
  }
});

test('runLocalPandaReplyIngressBuildCli writes safe stderr and exits 1 on unexpected builder errors', async () => {
  const run = await runBuildCli({
    input: JSON.stringify({
      dispatchPayload: validDispatchPayload(),
      reply: { text: 'Reply text' },
    }),
    buildLocalPandaReplyIngressPayloadV1: () => {
      throw new Error('builder refused postgresql://user:super-secret@127.0.0.1:5432/widget?token=abc');
    },
  });

  assert.deepEqual(run.stdout, []);
  assert.deepEqual(run.exitCodes, [1]);
  assert.equal(run.stderr[0], 'failed to build local Panda reply ingress payload from stdin\n');
  assert.deepEqual(JSON.parse(run.stderr[1] ?? '{}'), {
    name: 'Error',
    message: 'builder refused postgresql://user:[redacted]@127.0.0.1:5432/widget?token=[redacted]',
  });
  assert.equal(run.stderr.join('').includes('super-secret'), false);
  assert.equal(run.stderr.join('').includes('token=abc'), false);
  assert.equal(run.stderr.join('').includes('\n    at '), false);
});

test('local reply ingress build CLI package script and README document the local-only manual flow', () => {
  const serverPackage = JSON.parse(serverPackageSource) as { scripts?: Record<string, string> };

  assert.equal(
    serverPackage.scripts?.['local-panda:reply-ingress-build'],
    'node dist/local-panda-reply-ingress-build-cli.js',
  );
  assert.match(
    readmeSource,
    /cat reply-ingress-build-input\.json \| pnpm --silent --filter @panda-chat-widget\/server local-panda:reply-ingress-build/,
  );
  assert.match(readmeSource, /Copy or extract that dry-run envelope `payload` into/);
  assert.match(readmeSource, /Pipe or copy only the build envelope's `payload` JSON object into the apply CLI/);
  assert.match(readmeSource, /The build step performs no DB access, no reply apply, no state mutation/);
  assert.match(readmeSource, /it is not real Panda\/Gateway integration/);
});

test('local reply ingress build CLI stays server-only without DB, apply, public route, frontend, network, worker, or status expansion', () => {
  const combinedFrontendSource = `${consoleSource}\n${widgetUiSource}`;

  assert.match(buildCliSource, /buildLocalPandaReplyIngressPayloadV1/);
  assert.match(buildCliSource, /from '\.\/local-panda-reply-ingress-payload\.ts'/);
  assert.doesNotMatch(
    buildCliSource,
    /from ['"]\.\/(?:config|db|local-panda-reply-ingress-apply|migrate|migration-runner|fake-responder)\.ts/,
  );
  assert.doesNotMatch(
    buildCliSource,
    /loadDatabaseConfig|createDatabase|DatabaseClient|DatabaseExecutor|selectFrom|insertInto|updateTable|deleteFrom|transaction\(|Kysely|applyLocalPandaReplyIngressPayloadV1/i,
  );
  assert.doesNotMatch(
    buildCliSource,
    /fetch\s*\(|WebSocket|EventSource|node:http|node:https|node:child_process|child_process|spawn\s*\(|exec\s*\(|setTimeout\s*\(|setInterval\s*\(|Worker\s*\(|dispatcher|daemon|retry|dead-letter|fake-responder|createFakeResponderReply|\.schema|createTable|alterTable|addColumn|dropTable|dropColumn|status:\s*'sent'|status:\s*'delivered'|status:\s*'failed'|status:\s*'replied'|sent_at|delivered_at|failed_at|replied_at/i,
  );
  assert.doesNotMatch(
    buildCliSource,
    /panda\s+(?:a2a|send|gateway)|gateway\s+(?:url|token|request|response|dispatch)/i,
  );
  assert.doesNotMatch(
    appSource,
    /local-panda-reply-ingress-build|runLocalPandaReplyIngressBuildCli|LocalPandaReplyIngressBuildCliResult/,
  );
  assert.doesNotMatch(
    visitorMessageSource,
    /local-panda-reply-ingress-build|runLocalPandaReplyIngressBuildCli|LocalPandaReplyIngressBuildCliResult/,
  );
  assert.doesNotMatch(
    combinedFrontendSource,
    /local-panda-reply-ingress-build|runLocalPandaReplyIngressBuildCli|LocalPandaReplyIngressBuildCliResult/,
  );
});

type BuildCliRunOptions = {
  input: string;
  buildLocalPandaReplyIngressPayloadV1?: LocalPandaReplyIngressBuildCliDependencies['buildLocalPandaReplyIngressPayloadV1'];
};

type BuildCliRun = {
  stdout: string[];
  stderr: string[];
  exitCodes: number[];
};

async function runBuildCli(options: BuildCliRunOptions): Promise<BuildCliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];

  const dependencies: LocalPandaReplyIngressBuildCliDependencies = {
    readStdin: async () => options.input,
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
    setExitCode: (exitCode) => exitCodes.push(exitCode),
  };

  if (options.buildLocalPandaReplyIngressPayloadV1) {
    dependencies.buildLocalPandaReplyIngressPayloadV1 = options.buildLocalPandaReplyIngressPayloadV1;
  }

  await runLocalPandaReplyIngressBuildCli(dependencies);

  return { stdout, stderr, exitCodes };
}

function assertBuildCliBaseEnvelope(envelope: Record<string, unknown>): void {
  assert.equal(envelope.kind, BUILD_CLI_KIND);
  assert.equal(envelope.mode, BUILD_CLI_MODE);
  assert.deepEqual(envelope.metadata, BUILD_CLI_METADATA);
}

function parseCliJsonObject(stdoutLine: string | undefined): Record<string, any> {
  assert.ok(stdoutLine !== undefined);
  assert.equal(stdoutLine.endsWith('\n'), true);

  return JSON.parse(stdoutLine) as Record<string, any>;
}

function validDispatchPayload(
  correlationOverrides: Partial<LocalPandaReplyIngressCorrelationIds> = {},
  overrides: Partial<LocalPandaDispatchPayloadV1> = {},
): LocalPandaDispatchPayloadV1 {
  const ids = correlationIds(correlationOverrides);

  return {
    version: 1,
    kind: 'local-panda-future-dispatch',
    idempotencyKey: 'local-panda-dispatch-v1:base-dispatch-key',
    routeHandleSnapshot: 'panda:workspace/alpha',
    intent: {
      id: ids.intentId,
      status: 'claimed',
      createdAt: '2026-01-01T00:00:00.000Z',
      claimedAt: '2026-01-01T00:10:00.000Z',
    },
    widget: { id: ids.widgetId },
    conversation: { id: ids.conversationId },
    visitorSession: { id: ids.visitorSessionId },
    visitorMessage: {
      id: ids.visitorMessageId,
      clientMessageId: ids.clientMessageId,
      body: 'Hello from the visitor',
      text: 'Hello from the visitor',
      createdAt: '2026-01-01T00:05:00.000Z',
    },
    correlationIds: ids,
    metadata: {
      locality: 'local-only',
      dispatch: 'future-dispatch',
      contract: 'contract-only',
      network: 'no-network',
      stateMutation: 'no-state-mutation',
      replyHandling: 'no-reply-handling',
    },
    ...overrides,
  };
}

function correlationIds(
  overrides: Partial<LocalPandaReplyIngressCorrelationIds> = {},
): LocalPandaReplyIngressCorrelationIds {
  return {
    ...baseCorrelationIds,
    ...overrides,
  };
}

async function readSourceTree(directory: URL): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks: string[] = [];

  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);

    if (entry.isDirectory()) {
      chunks.push(await readSourceTree(child));
    } else if (entry.isFile() && /\.(css|html|js|jsx|json|ts|tsx)$/.test(entry.name)) {
      chunks.push(await readFile(child, 'utf8'));
    }
  }

  return chunks.join('\n');
}
