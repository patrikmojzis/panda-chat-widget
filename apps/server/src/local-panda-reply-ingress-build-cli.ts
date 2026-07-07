import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildLocalPandaReplyIngressPayloadV1,
  type BuildLocalPandaReplyIngressPayloadV1Input,
  type BuildLocalPandaReplyIngressPayloadV1Result,
} from './local-panda-reply-ingress-payload.ts';
import { diagnosticErrorForCli } from './server-logging.ts';

type WritableStreamLike = {
  write: (chunk: string) => unknown;
};

type LocalPandaReplyIngressBuildParseFailureReason =
  | 'empty_stdin'
  | 'malformed_json'
  | 'json_value_not_object';

type LocalPandaReplyIngressBuildFailure = Extract<
  BuildLocalPandaReplyIngressPayloadV1Result,
  { built: false }
>;

type LocalPandaReplyIngressBuildSuccess = Extract<
  BuildLocalPandaReplyIngressPayloadV1Result,
  { built: true }
>;

export type LocalPandaReplyIngressBuildMetadata = {
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
  stateMutation: 'no-state-mutation';
  replyIngressApply: 'not-attempted';
  publicFakeReplyReplacement: 'not-attempted';
};

export type LocalPandaReplyIngressBuildBase = {
  kind: 'local-panda-reply-ingress-build';
  mode: 'local-only-stdin-reply-ingress-build';
  metadata: LocalPandaReplyIngressBuildMetadata;
};

export type LocalPandaReplyIngressBuildCliResult =
  | (LocalPandaReplyIngressBuildBase & {
      built: true;
      parsed: true;
      payload: LocalPandaReplyIngressBuildSuccess['payload'];
    })
  | (LocalPandaReplyIngressBuildBase & {
      built: false;
      parsed: true;
      failedStep: 'reply_ingress_build';
      reason: LocalPandaReplyIngressBuildFailure['reason'];
      buildResult: LocalPandaReplyIngressBuildFailure;
    })
  | (LocalPandaReplyIngressBuildBase & {
      built: false;
      parsed: false;
      failedStep: 'stdin_parse';
      reason: LocalPandaReplyIngressBuildParseFailureReason;
    });

export type LocalPandaReplyIngressBuildCliDependencies = {
  buildLocalPandaReplyIngressPayloadV1?: (
    input: BuildLocalPandaReplyIngressPayloadV1Input,
  ) => BuildLocalPandaReplyIngressPayloadV1Result;
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
      reason: LocalPandaReplyIngressBuildParseFailureReason;
    };

const REPLY_INGRESS_BUILD_KIND = 'local-panda-reply-ingress-build';
const REPLY_INGRESS_BUILD_MODE = 'local-only-stdin-reply-ingress-build';
const REPLY_INGRESS_BUILD_METADATA: LocalPandaReplyIngressBuildMetadata = {
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

export async function runLocalPandaReplyIngressBuildCli(
  dependencies: LocalPandaReplyIngressBuildCliDependencies = {},
): Promise<void> {
  const resolved = resolveDependencies(dependencies);

  try {
    const parseResult = parseStdinJsonObject(await resolved.readStdin());

    if (!parseResult.parsed) {
      writeJsonLine(resolved.stdout, {
        ...replyIngressBuildBase(),
        built: false,
        parsed: false,
        failedStep: 'stdin_parse',
        reason: parseResult.reason,
      } satisfies LocalPandaReplyIngressBuildCliResult);
      resolved.setExitCode(1);
      return;
    }

    const buildResult = resolved.buildLocalPandaReplyIngressPayloadV1(toBuilderInput(parseResult.value));

    if (!buildResult.built) {
      writeJsonLine(resolved.stdout, {
        ...replyIngressBuildBase(),
        built: false,
        parsed: true,
        failedStep: 'reply_ingress_build',
        reason: buildResult.reason,
        buildResult,
      } satisfies LocalPandaReplyIngressBuildCliResult);
      return;
    }

    writeJsonLine(resolved.stdout, {
      ...replyIngressBuildBase(),
      built: true,
      parsed: true,
      payload: buildResult.payload,
    } satisfies LocalPandaReplyIngressBuildCliResult);
  } catch (error) {
    resolved.stderr.write('failed to build local Panda reply ingress payload from stdin\n');
    writeJsonLine(resolved.stderr, diagnosticErrorForCli(error));
    resolved.setExitCode(1);
  }
}

function resolveDependencies(
  dependencies: LocalPandaReplyIngressBuildCliDependencies,
): Required<LocalPandaReplyIngressBuildCliDependencies> {
  return {
    buildLocalPandaReplyIngressPayloadV1:
      dependencies.buildLocalPandaReplyIngressPayloadV1 ?? buildLocalPandaReplyIngressPayloadV1,
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

function toBuilderInput(value: Record<string, unknown>): BuildLocalPandaReplyIngressPayloadV1Input {
  const dispatchPayload = value.dispatchPayload;

  return {
    dispatchPayload,
    reply: withDefaultReplyCorrelationIds(value.reply, dispatchPayload),
  } as unknown as BuildLocalPandaReplyIngressPayloadV1Input;
}

function withDefaultReplyCorrelationIds(reply: unknown, dispatchPayload: unknown): unknown {
  if (!isRecord(reply) || Object.hasOwn(reply, 'correlationIds')) {
    return reply;
  }

  const correlationIds = isRecord(dispatchPayload) ? dispatchPayload.correlationIds : undefined;

  return {
    ...reply,
    correlationIds,
  };
}

function replyIngressBuildBase(): LocalPandaReplyIngressBuildBase {
  return {
    kind: REPLY_INGRESS_BUILD_KIND,
    mode: REPLY_INGRESS_BUILD_MODE,
    metadata: { ...REPLY_INGRESS_BUILD_METADATA },
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
  await runLocalPandaReplyIngressBuildCli();
}
