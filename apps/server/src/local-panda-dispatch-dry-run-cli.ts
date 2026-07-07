import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDatabaseConfig, type DatabaseConfig } from './config.ts';
import { closeDatabase, createDatabase, type DatabaseClient } from './db.ts';
import {
  prepareNextLocalPandaDispatchDryRun,
  type LocalPandaDispatchDryRunResult,
} from './local-panda-dispatch-dry-run.ts';
import { diagnosticErrorForCli } from './server-logging.ts';

type WritableStreamLike = {
  write: (chunk: string) => unknown;
};

export type LocalPandaDispatchDryRunCliDependencies = {
  closeDatabase?: (database: DatabaseClient) => Promise<void>;
  createDatabase?: (config: DatabaseConfig) => DatabaseClient;
  loadDatabaseConfig?: () => DatabaseConfig;
  prepareNextLocalPandaDispatchDryRun?: (database: DatabaseClient) => Promise<LocalPandaDispatchDryRunResult>;
  setExitCode?: (exitCode: number) => void;
  stderr?: WritableStreamLike;
  stdout?: WritableStreamLike;
};

export async function runLocalPandaDispatchDryRunCli(
  dependencies: LocalPandaDispatchDryRunCliDependencies = {},
): Promise<void> {
  const resolved = resolveDependencies(dependencies);

  try {
    const database = resolved.createDatabase(resolved.loadDatabaseConfig());

    try {
      const result = await resolved.prepareNextLocalPandaDispatchDryRun(database);
      writeJsonLine(resolved.stdout, result);
    } finally {
      await resolved.closeDatabase(database);
    }
  } catch (error) {
    resolved.stderr.write('failed to prepare local Panda dispatch payload dry run\n');
    writeJsonLine(resolved.stderr, diagnosticErrorForCli(error));
    resolved.setExitCode(1);
  }
}

function resolveDependencies(
  dependencies: LocalPandaDispatchDryRunCliDependencies,
): Required<LocalPandaDispatchDryRunCliDependencies> {
  return {
    closeDatabase: dependencies.closeDatabase ?? closeDatabase,
    createDatabase: dependencies.createDatabase ?? createDatabase,
    loadDatabaseConfig: dependencies.loadDatabaseConfig ?? loadDatabaseConfig,
    prepareNextLocalPandaDispatchDryRun:
      dependencies.prepareNextLocalPandaDispatchDryRun ?? prepareNextLocalPandaDispatchDryRun,
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
  await runLocalPandaDispatchDryRunCli();
}
