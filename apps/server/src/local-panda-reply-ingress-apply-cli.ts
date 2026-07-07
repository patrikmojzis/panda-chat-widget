import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDatabaseConfig, type DatabaseConfig } from './config.ts';
import { closeDatabase, createDatabase, type DatabaseClient } from './db.ts';
import {
  applyLocalPandaReplyIngressPayloadV1,
  type ApplyLocalPandaReplyIngressPayloadV1Result,
} from './local-panda-reply-ingress-apply.ts';
import type { LocalPandaReplyIngressPayloadV1 } from './local-panda-reply-ingress-payload.ts';
import { diagnosticErrorForCli } from './server-logging.ts';

type WritableStreamLike = {
  write: (chunk: string) => unknown;
};

type LocalPandaReplyIngressApplyParseFailureReason =
  | 'empty_stdin'
  | 'malformed_json'
  | 'json_value_not_object';

type LocalPandaReplyIngressApplyFailure = Extract<
  ApplyLocalPandaReplyIngressPayloadV1Result,
  { applied: false }
>;

type LocalPandaReplyIngressApplySuccess = Extract<
  ApplyLocalPandaReplyIngressPayloadV1Result,
  { applied: true }
>;

export type LocalPandaReplyIngressApplyMetadata = {
  locality: 'local-only';
  input: 'stdin-json-object';
  network: 'no-network';
  pandaCall: 'not-attempted';
  gatewayCall: 'not-attempted';
  externalCliCall: 'not-attempted';
  childProcess: 'not-used';
  publicRoute: 'not-created';
  worker: 'not-created';
  statusLifecycleExpansion: 'not-attempted';
  stateMutation: 'local-db-apply-or-replay-via-existing-helper';
};

export type LocalPandaReplyIngressApplyBase = {
  kind: 'local-panda-reply-ingress-apply';
  mode: 'local-only-stdin-reply-ingress-apply';
  metadata: LocalPandaReplyIngressApplyMetadata;
};

export type LocalPandaReplyIngressApplyCliResult =
  | (LocalPandaReplyIngressApplyBase & {
      completed: true;
      parsed: true;
      applyResult: LocalPandaReplyIngressApplySuccess;
    })
  | (LocalPandaReplyIngressApplyBase & {
      completed: false;
      parsed: true;
      failedStep: 'apply_reply_ingress';
      reason: LocalPandaReplyIngressApplyFailure['reason'];
      applyResult: LocalPandaReplyIngressApplyFailure;
    })
  | (LocalPandaReplyIngressApplyBase & {
      completed: false;
      parsed: false;
      failedStep: 'stdin_parse';
      reason: LocalPandaReplyIngressApplyParseFailureReason;
    });

export type LocalPandaReplyIngressApplyCliDependencies = {
  applyLocalPandaReplyIngressPayloadV1?: (
    database: DatabaseClient,
    payload: LocalPandaReplyIngressPayloadV1,
  ) => Promise<ApplyLocalPandaReplyIngressPayloadV1Result>;
  closeDatabase?: (database: DatabaseClient) => Promise<void>;
  createDatabase?: (config: DatabaseConfig) => DatabaseClient;
  loadDatabaseConfig?: () => DatabaseConfig;
  readStdin?: () => Promise<string>;
  setExitCode?: (exitCode: number) => void;
  stderr?: WritableStreamLike;
  stdout?: WritableStreamLike;
};

type StdinParseResult =
  | {
      parsed: true;
      value: Record<string, unknown>;
    }
  | {
      parsed: false;
      reason: LocalPandaReplyIngressApplyParseFailureReason;
    };

const REPLY_INGRESS_APPLY_KIND = 'local-panda-reply-ingress-apply';
const REPLY_INGRESS_APPLY_MODE = 'local-only-stdin-reply-ingress-apply';
const REPLY_INGRESS_APPLY_METADATA: LocalPandaReplyIngressApplyMetadata = {
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
  stateMutation: 'local-db-apply-or-replay-via-existing-helper',
};

export async function runLocalPandaReplyIngressApplyCli(
  dependencies: LocalPandaReplyIngressApplyCliDependencies = {},
): Promise<void> {
  const resolved = resolveDependencies(dependencies);
  let database: DatabaseClient | undefined;

  try {
    const parseResult = parseStdinJsonObject(await resolved.readStdin());

    if (!parseResult.parsed) {
      writeJsonLine(resolved.stdout, {
        ...replyIngressApplyBase(),
        completed: false,
        parsed: false,
        failedStep: 'stdin_parse',
        reason: parseResult.reason,
      } satisfies LocalPandaReplyIngressApplyCliResult);
      resolved.setExitCode(1);
      return;
    }

    database = resolved.createDatabase(resolved.loadDatabaseConfig());

    try {
      const applyResult = await resolved.applyLocalPandaReplyIngressPayloadV1(
        database,
        parseResult.value as LocalPandaReplyIngressPayloadV1,
      );

      if (!applyResult.applied) {
        writeJsonLine(resolved.stdout, {
          ...replyIngressApplyBase(),
          completed: false,
          parsed: true,
          failedStep: 'apply_reply_ingress',
          reason: applyResult.reason,
          applyResult,
        } satisfies LocalPandaReplyIngressApplyCliResult);
        return;
      }

      writeJsonLine(resolved.stdout, {
        ...replyIngressApplyBase(),
        completed: true,
        parsed: true,
        applyResult,
      } satisfies LocalPandaReplyIngressApplyCliResult);
    } finally {
      await resolved.closeDatabase(database);
    }
  } catch (error) {
    resolved.stderr.write('failed to apply local Panda reply ingress payload from stdin\n');
    writeJsonLine(resolved.stderr, diagnosticErrorForCli(error));
    resolved.setExitCode(1);
  }
}

function resolveDependencies(
  dependencies: LocalPandaReplyIngressApplyCliDependencies,
): Required<LocalPandaReplyIngressApplyCliDependencies> {
  return {
    applyLocalPandaReplyIngressPayloadV1:
      dependencies.applyLocalPandaReplyIngressPayloadV1 ?? applyLocalPandaReplyIngressPayloadV1,
    closeDatabase: dependencies.closeDatabase ?? closeDatabase,
    createDatabase: dependencies.createDatabase ?? createDatabase,
    loadDatabaseConfig: dependencies.loadDatabaseConfig ?? loadDatabaseConfig,
    readStdin: dependencies.readStdin ?? readStdin,
    setExitCode: dependencies.setExitCode ?? ((exitCode) => {
      process.exitCode = exitCode;
    }),
    stderr: dependencies.stderr ?? process.stderr,
    stdout: dependencies.stdout ?? process.stdout,
  };
}

async function readStdin(): Promise<string> {
  let input = '';
  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    input += String(chunk);
  }

  return input;
}

function parseStdinJsonObject(stdin: string): StdinParseResult {
  const trimmed = stdin.trim();

  if (trimmed === '') {
    return { parsed: false, reason: 'empty_stdin' };
  }

  let value: unknown;

  try {
    value = JSON.parse(trimmed) as unknown;
  } catch {
    return { parsed: false, reason: 'malformed_json' };
  }

  if (!isRecord(value)) {
    return { parsed: false, reason: 'json_value_not_object' };
  }

  return { parsed: true, value };
}

function replyIngressApplyBase(): LocalPandaReplyIngressApplyBase {
  return {
    kind: REPLY_INGRESS_APPLY_KIND,
    mode: REPLY_INGRESS_APPLY_MODE,
    metadata: { ...REPLY_INGRESS_APPLY_METADATA },
  };
}

function writeJsonLine(stream: WritableStreamLike, value: unknown): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMainModule(moduleUrl: string): boolean {
  const entrypoint = process.argv[1];

  return entrypoint !== undefined && fileURLToPath(moduleUrl) === path.resolve(entrypoint);
}

if (isMainModule(import.meta.url)) {
  await runLocalPandaReplyIngressApplyCli();
}
