import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDatabaseConfig, type DatabaseConfig } from './config.ts';
import { closeDatabase, createDatabase, type DatabaseClient } from './db.ts';
import {
  runNextLocalPandaReplyManual,
  type LocalPandaReplyManualBase,
  type LocalPandaReplyManualInput,
  type LocalPandaReplyManualMetadata,
  type LocalPandaReplyManualResult,
} from './local-panda-reply-manual.ts';
import { diagnosticErrorForCli } from './server-logging.ts';

type WritableStreamLike = {
  write: (chunk: string) => unknown;
};

type LocalPandaReplyManualParseFailureReason = 'empty_stdin' | 'malformed_json' | 'json_value_not_object';
type LocalPandaReplyManualValidationFailureReason =
  | 'missing_reply_text'
  | 'invalid_reply_text'
  | 'invalid_target_intent_id';

export type LocalPandaReplyManualCliResult =
  | LocalPandaReplyManualResult
  | (LocalPandaReplyManualBase & {
      completed: false;
      parsed: false;
      failedStep: 'stdin_parse';
      reason: LocalPandaReplyManualParseFailureReason;
    })
  | (LocalPandaReplyManualBase & {
      completed: false;
      parsed: true;
      failedStep: 'manual_reply_validation';
      reason: LocalPandaReplyManualValidationFailureReason;
    });

export type LocalPandaReplyManualCliDependencies = {
  closeDatabase?: (database: DatabaseClient) => Promise<void>;
  createDatabase?: (config: DatabaseConfig) => DatabaseClient;
  loadDatabaseConfig?: () => DatabaseConfig;
  readStdin?: () => Promise<string>;
  runNextLocalPandaReplyManual?: (
    database: DatabaseClient,
    input: LocalPandaReplyManualInput,
  ) => Promise<LocalPandaReplyManualResult>;
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
      reason: LocalPandaReplyManualParseFailureReason;
    };

type ManualReplyTextValidationResult =
  | {
      valid: true;
      text: string;
    }
  | {
      valid: false;
      reason: Extract<LocalPandaReplyManualValidationFailureReason, 'missing_reply_text' | 'invalid_reply_text'>;
    };

type TargetIntentIdValidationResult =
  | {
      valid: true;
      targetIntentId?: string;
    }
  | {
      valid: false;
      reason: Extract<LocalPandaReplyManualValidationFailureReason, 'invalid_target_intent_id'>;
    };

const MANUAL_REPLY_KIND = 'local-panda-one-shot-manual-reply-round-trip';
const MANUAL_REPLY_MODE = 'local-only-stdin-manual-reply';
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export async function runLocalPandaReplyManualCli(
  dependencies: LocalPandaReplyManualCliDependencies = {},
): Promise<void> {
  const resolved = resolveDependencies(dependencies);

  try {
    const parseResult = parseStdinJsonObject(await resolved.readStdin());

    if (!parseResult.parsed) {
      writeJsonLine(resolved.stdout, {
        ...manualReplyBase(),
        completed: false,
        parsed: false,
        failedStep: 'stdin_parse',
        reason: parseResult.reason,
      } satisfies LocalPandaReplyManualCliResult);
      resolved.setExitCode(1);
      return;
    }

    const targetIntentId = validateTargetIntentId(parseResult.value);

    if (!targetIntentId.valid) {
      writeJsonLine(resolved.stdout, {
        ...manualReplyBase(),
        completed: false,
        parsed: true,
        failedStep: 'manual_reply_validation',
        reason: targetIntentId.reason,
      } satisfies LocalPandaReplyManualCliResult);
      resolved.setExitCode(1);
      return;
    }

    const manualReplyText = validateManualReplyText(parseResult.value);

    if (!manualReplyText.valid) {
      writeJsonLine(resolved.stdout, {
        ...manualReplyBase(),
        completed: false,
        parsed: true,
        failedStep: 'manual_reply_validation',
        reason: manualReplyText.reason,
      } satisfies LocalPandaReplyManualCliResult);
      resolved.setExitCode(1);
      return;
    }

    const database = resolved.createDatabase(resolved.loadDatabaseConfig());

    try {
      const result = await resolved.runNextLocalPandaReplyManual(database, {
        normalizedReplyText: manualReplyText.text,
        ...(targetIntentId.targetIntentId === undefined ? {} : { targetIntentId: targetIntentId.targetIntentId }),
      });
      writeJsonLine(resolved.stdout, result);
    } finally {
      await resolved.closeDatabase(database);
    }
  } catch (error) {
    resolved.stderr.write('failed to run local Panda manual reply round trip from stdin\n');
    writeJsonLine(resolved.stderr, diagnosticErrorForCli(error));
    resolved.setExitCode(1);
  }
}

function resolveDependencies(
  dependencies: LocalPandaReplyManualCliDependencies,
): Required<LocalPandaReplyManualCliDependencies> {
  return {
    closeDatabase: dependencies.closeDatabase ?? closeDatabase,
    createDatabase: dependencies.createDatabase ?? createDatabase,
    loadDatabaseConfig: dependencies.loadDatabaseConfig ?? loadDatabaseConfig,
    readStdin: dependencies.readStdin ?? readStdin,
    runNextLocalPandaReplyManual: dependencies.runNextLocalPandaReplyManual ?? runNextLocalPandaReplyManual,
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

function validateManualReplyText(value: Record<string, unknown>): ManualReplyTextValidationResult {
  const reply = value.reply;

  if (!isRecord(reply) || !Object.hasOwn(reply, 'text') || reply.text === undefined) {
    return { valid: false, reason: 'missing_reply_text' };
  }

  if (typeof reply.text !== 'string') {
    return { valid: false, reason: 'invalid_reply_text' };
  }

  const text = reply.text.trim();

  if (text === '') {
    return { valid: false, reason: 'missing_reply_text' };
  }

  return { valid: true, text };
}

function validateTargetIntentId(value: Record<string, unknown>): TargetIntentIdValidationResult {
  if (!Object.hasOwn(value, 'targetIntentId')) {
    return { valid: true };
  }

  const targetIntentId = value.targetIntentId;

  if (typeof targetIntentId !== 'string') {
    return { valid: false, reason: 'invalid_target_intent_id' };
  }

  const normalizedTargetIntentId = targetIntentId.trim().toLowerCase();

  if (!CANONICAL_UUID_PATTERN.test(normalizedTargetIntentId)) {
    return { valid: false, reason: 'invalid_target_intent_id' };
  }

  return { valid: true, targetIntentId: normalizedTargetIntentId };
}

function manualReplyBase(): LocalPandaReplyManualBase {
  return {
    kind: MANUAL_REPLY_KIND,
    mode: MANUAL_REPLY_MODE,
    metadata: { ...MANUAL_REPLY_METADATA },
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
  await runLocalPandaReplyManualCli();
}
