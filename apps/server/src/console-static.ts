import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { authenticateRequest } from './auth-guard.ts';
import type { DatabaseClient } from './db.ts';

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
  let decodedPath: string;

  try {
    decodedPath = decodeURIComponent(requestPath.replace(/^\/+/, ''));
  } catch {
    return null;
  }

  const segments = decodedPath.split('/');

  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null;
  }

  const root = path.resolve(distPath);
  const filePath = path.resolve(root, ...segments);
  const relativePath = path.relative(root, filePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return filePath;
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
  return serveFile(path.join(distPath, 'index.html'), reply, 'text/html; charset=utf-8');
}

async function serveConsoleAsset(distPath: string, requestPath: string, reply: FastifyReply): Promise<FastifyReply> {
  const filePath = resolveConsoleDistFile(distPath, requestPath);

  if (!filePath) {
    return reply.status(404).type('text/plain; charset=utf-8').send('Not found');
  }

  return serveFile(filePath, reply, contentTypeForPath(filePath));
}

async function serveFile(filePath: string, reply: FastifyReply, contentType: string): Promise<FastifyReply> {
  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      return reply.status(404).type('text/plain; charset=utf-8').send('Not found');
    }

    return reply
      .header('content-length', fileStat.size)
      .type(contentType)
      .send(createReadStream(filePath));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return reply.status(404).type('text/plain; charset=utf-8').send('Not found');
    }

    throw error;
  }
}

function readRawConsolePath(request: FastifyRequest): string | null {
  const rawPath = (request.raw.url ?? '').split('?')[0] ?? '';

  if (!rawPath.startsWith('/console/')) {
    return null;
  }

  return rawPath.slice('/console'.length);
}

function contentTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}
