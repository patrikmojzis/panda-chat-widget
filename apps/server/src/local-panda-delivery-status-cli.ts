import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDatabaseConfig, type DatabaseConfig } from './config.ts';
import { closeDatabase, createDatabase, type DatabaseClient } from './db.ts';
import {
  readLocalPandaDeliveryStatus,
  type LocalPandaDeliveryStatusResult,
} from './local-panda-delivery-status.ts';
import { diagnosticErrorForCli } from './server-logging.ts';

type WritableStreamLike = {
  write: (chunk: string) => unknown;
};

export type LocalPandaDeliveryStatusCliDependencies = {
  closeDatabase?: (database: DatabaseClient) => Promise<void>;
  createDatabase?: (config: DatabaseConfig) => DatabaseClient;
  loadDatabaseConfig?: () => DatabaseConfig;
  readLocalPandaDeliveryStatus?: (database: DatabaseClient) => Promise<LocalPandaDeliveryStatusResult>;
  setExitCode?: (exitCode: number) => void;
  stderr?: WritableStreamLike;
  stdout?: WritableStreamLike;
};

export async function runLocalPandaDeliveryStatusCli(
  dependencies: LocalPandaDeliveryStatusCliDependencies = {},
): Promise<void> {
  const resolved = resolveDependencies(dependencies);

  try {
    const database = resolved.createDatabase(resolved.loadDatabaseConfig());

    try {
      const result = await resolved.readLocalPandaDeliveryStatus(database);
      writeJsonLine(resolved.stdout, result);
    } finally {
      await resolved.closeDatabase(database);
    }
  } catch (error) {
    resolved.stderr.write('failed to read local Panda delivery status diagnostics\n');
    writeJsonLine(resolved.stderr, diagnosticErrorForCli(error));
    resolved.setExitCode(1);
  }
}

function resolveDependencies(
  dependencies: LocalPandaDeliveryStatusCliDependencies,
): Required<LocalPandaDeliveryStatusCliDependencies> {
  return {
    closeDatabase: dependencies.closeDatabase ?? closeDatabase,
    createDatabase: dependencies.createDatabase ?? createDatabase,
    loadDatabaseConfig: dependencies.loadDatabaseConfig ?? loadDatabaseConfig,
    readLocalPandaDeliveryStatus: dependencies.readLocalPandaDeliveryStatus ?? readLocalPandaDeliveryStatus,
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
  await runLocalPandaDeliveryStatusCli();
}
