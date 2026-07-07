import type { FastifyInstance } from 'fastify';

import { buildApp, type BuildAppOptions } from './app.ts';
import {
  loadConfig,
  loadDatabaseConfig,
  type DatabaseConfig,
  type ServerConfig,
} from './config.ts';
import {
  closeDatabase,
  createDatabase,
  type DatabaseClient,
} from './db.ts';
import { listen, type ListenOptions } from './listen.ts';
import { safeErrorForLog } from './server-logging.ts';

export type ServerRuntime = {
  app: FastifyInstance;
  config: ServerConfig;
  database: DatabaseClient;
};

export type ServerRuntimeDependencies = {
  buildApp?: (options: BuildAppOptions) => FastifyInstance;
  closeDatabase?: (database: DatabaseClient) => Promise<void>;
  createDatabase?: (config: DatabaseConfig) => DatabaseClient;
  listen?: (app: FastifyInstance, options: ListenOptions) => Promise<string>;
  loadConfig?: () => ServerConfig;
  loadDatabaseConfig?: () => DatabaseConfig;
  setExitCode?: (exitCode: number) => void;
};

export async function startServerRuntime(dependencies: ServerRuntimeDependencies = {}): Promise<ServerRuntime | null> {
  const resolved = resolveDependencies(dependencies);
  const config = resolved.loadConfig();
  const database = resolved.createDatabase(resolved.loadDatabaseConfig());
  const app = resolved.buildApp({ logger: config.logger, database, auth: config.auth });

  app.addHook('onClose', async () => {
    await resolved.closeDatabase(database);
  });

  try {
    await resolved.listen(app, config.listen);

    return { app, config, database };
  } catch (error) {
    app.log.error({ error: safeErrorForLog(error) }, 'server failed to start');
    await closeAppAfterStartFailure(app);
    resolved.setExitCode(1);

    return null;
  }
}

function resolveDependencies(dependencies: ServerRuntimeDependencies): Required<ServerRuntimeDependencies> {
  return {
    buildApp: dependencies.buildApp ?? buildApp,
    closeDatabase: dependencies.closeDatabase ?? closeDatabase,
    createDatabase: dependencies.createDatabase ?? createDatabase,
    listen: dependencies.listen ?? listen,
    loadConfig: dependencies.loadConfig ?? loadConfig,
    loadDatabaseConfig: dependencies.loadDatabaseConfig ?? loadDatabaseConfig,
    setExitCode: dependencies.setExitCode ?? ((exitCode) => {
      process.exitCode = exitCode;
    }),
  };
}

async function closeAppAfterStartFailure(app: FastifyInstance): Promise<void> {
  try {
    await app.close();
  } catch (error) {
    app.log.error({ error: safeErrorForLog(error) }, 'server cleanup failed after start failure');
  }
}
