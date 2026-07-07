import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDatabaseConfig, type DatabaseConfig } from './config.ts';
import { closeDatabase, createDatabase, type DatabaseClient } from './db.ts';
import {
  runNextLocalPandaReplyRoundTrip,
  type LocalPandaReplyRoundTripResult,
} from './local-panda-reply-round-trip.ts';
import { diagnosticErrorForCli } from './server-logging.ts';

type WritableStreamLike = {
  write: (chunk: string) => unknown;
};

export type LocalPandaReplyRoundTripCliDependencies = {
  closeDatabase?: (database: DatabaseClient) => Promise<void>;
  createDatabase?: (config: DatabaseConfig) => DatabaseClient;
  loadDatabaseConfig?: () => DatabaseConfig;
  runNextLocalPandaReplyRoundTrip?: (database: DatabaseClient) => Promise<LocalPandaReplyRoundTripResult>;
  setExitCode?: (exitCode: number) => void;
  stderr?: WritableStreamLike;
  stdout?: WritableStreamLike;
};

export async function runLocalPandaReplyRoundTripCli(
  dependencies: LocalPandaReplyRoundTripCliDependencies = {},
): Promise<void> {
  const resolved = resolveDependencies(dependencies);

  try {
    const database = resolved.createDatabase(resolved.loadDatabaseConfig());

    try {
      const result = await resolved.runNextLocalPandaReplyRoundTrip(database);
      writeJsonLine(resolved.stdout, result);
    } finally {
      await resolved.closeDatabase(database);
    }
  } catch (error) {
    resolved.stderr.write('failed to run local Panda deterministic fake reply round trip\n');
    writeJsonLine(resolved.stderr, diagnosticErrorForCli(error));
    resolved.setExitCode(1);
  }
}

function resolveDependencies(
  dependencies: LocalPandaReplyRoundTripCliDependencies,
): Required<LocalPandaReplyRoundTripCliDependencies> {
  return {
    closeDatabase: dependencies.closeDatabase ?? closeDatabase,
    createDatabase: dependencies.createDatabase ?? createDatabase,
    loadDatabaseConfig: dependencies.loadDatabaseConfig ?? loadDatabaseConfig,
    runNextLocalPandaReplyRoundTrip: dependencies.runNextLocalPandaReplyRoundTrip ?? runNextLocalPandaReplyRoundTrip,
    setExitCode: dependencies.setExitCode ?? ((exitCode) => {
      process.exitCode = exitCode;
    }),
    stderr: dependencies.stderr ?? process.stderr,
    stdout: dependencies.stdout ?? process.stdout,
  };
}

function writeJsonLine(stream: WritableStreamLike, value: unknown): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function isMainModule(moduleUrl: string): boolean {
  const entrypoint = process.argv[1];

  return entrypoint !== undefined && fileURLToPath(moduleUrl) === path.resolve(entrypoint);
}

if (isMainModule(import.meta.url)) {
  await runLocalPandaReplyRoundTripCli();
}
