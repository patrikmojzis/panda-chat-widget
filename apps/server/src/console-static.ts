import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { authenticateRequest } from './auth-guard.ts';
import type { DatabaseClient } from './db.ts';
import { resolveStaticFile, serveStaticFile } from './static-files.ts';

export const DEFAULT_CONSOLE_DIST_PATH = fileURLToPath(new URL('../../console/dist', import.meta.url));

export type ConsoleStaticRouteOptions = {
  database: DatabaseClient;
  distPath?: string;
};

type ConsoleWildcardRoute = {
  Params: {
    '*': string;
  };
};

export function registerConsoleStaticRoutes(app: FastifyInstance, options: ConsoleStaticRouteOptions): void {
  const distPath = path.resolve(options.distPath ?? DEFAULT_CONSOLE_DIST_PATH);

  app.get('/console', async (request, reply) => serveProtectedConsoleIndex(options.database, distPath, request, reply));
  app.get('/console/', async (request, reply) => serveProtectedConsoleIndex(options.database, distPath, request, reply));
  app.get<ConsoleWildcardRoute>('/console/*', async (request, reply) => {
    const consolePath = readRawConsolePath(request) ?? `/${request.params['*'] ?? ''}`;

    if (consolePath.startsWith('/assets/')) {
      return serveConsoleAsset(distPath, consolePath, reply);
    }

    if (consolePath === '/index.html') {
      return reply.status(404).type('text/plain; charset=utf-8').send('Not found');
    }

    if (consolePath === '/login' || consolePath === '/setup') {
      return serveConsoleIndex(distPath, reply);
    }

    return serveProtectedConsoleIndex(options.database, distPath, request, reply);
  });
}

export function resolveConsoleDistFile(distPath: string, requestPath: string): string | null {
  return resolveStaticFile(distPath, requestPath);
}

async function serveProtectedConsoleIndex(
  database: DatabaseClient,
  distPath: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> {
  const auth = await authenticateRequest(database, request);

  if (!auth) {
    return reply.redirect('/console/login');
  }

  return serveConsoleIndex(distPath, reply);
}

async function serveConsoleIndex(distPath: string, reply: FastifyReply): Promise<FastifyReply> {
  return serveStaticFile(path.join(distPath, 'index.html'), reply, 'text/html; charset=utf-8');
}

async function serveConsoleAsset(distPath: string, requestPath: string, reply: FastifyReply): Promise<FastifyReply> {
  const filePath = resolveConsoleDistFile(distPath, requestPath);

  if (!filePath) {
    return reply.status(404).type('text/plain; charset=utf-8').send('Not found');
  }

  return serveStaticFile(filePath, reply);
}

function readRawConsolePath(request: FastifyRequest): string | null {
  const rawPath = (request.raw.url ?? '').split('?')[0] ?? '';

  if (!rawPath.startsWith('/console/')) {
    return null;
  }

  return rawPath.slice('/console'.length);
}
