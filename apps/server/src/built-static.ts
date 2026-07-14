import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { resolveStaticFile, serveStaticFile } from './static-files.ts';

export const DEFAULT_WIDGET_DIST_PATH = fileURLToPath(new URL('../../widget-ui/dist', import.meta.url));
export const DEFAULT_LOADER_DIST_PATH = fileURLToPath(new URL('../../../packages/loader/dist', import.meta.url));
export const DEFAULT_REFERENCE_DIST_PATH = fileURLToPath(new URL('../../../examples/basic-html/dist', import.meta.url));

export type BuiltStaticRouteOptions = {
  loaderDistPath?: string;
  referenceDistPath?: string;
  widgetDistPath?: string;
};

type WildcardRoute = {
  Params: {
    '*': string;
  };
};

export function registerBuiltStaticRoutes(app: FastifyInstance, options: BuiltStaticRouteOptions = {}): void {
  const loaderDistPath = path.resolve(options.loaderDistPath ?? DEFAULT_LOADER_DIST_PATH);
  const referenceDistPath = path.resolve(options.referenceDistPath ?? DEFAULT_REFERENCE_DIST_PATH);
  const widgetDistPath = path.resolve(options.widgetDistPath ?? DEFAULT_WIDGET_DIST_PATH);

  app.get('/widget.html', async (_request, reply) => {
    return serveStaticFile(path.join(widgetDistPath, 'index.html'), reply);
  });

  app.get<WildcardRoute>('/assets/*', async (request, reply) => {
    return serveResolvedFile(widgetDistPath, readRawPath(request, '/'), reply);
  });

  app.get<WildcardRoute>('/vendor/*', async (request, reply) => {
    return serveResolvedFile(loaderDistPath, readRawPath(request, '/vendor/'), reply);
  });

  app.get('/reference', async (_request, reply) => reply.redirect('/reference/'));
  app.get('/reference/', async (_request, reply) => {
    return serveStaticFile(path.join(referenceDistPath, 'index.html'), reply);
  });
  app.get<WildcardRoute>('/reference/*', async (request, reply) => {
    return serveResolvedFile(referenceDistPath, readRawPath(request, '/reference/'), reply);
  });
}

async function serveResolvedFile(
  rootPath: string,
  requestPath: string | null,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const filePath = requestPath === null ? null : resolveStaticFile(rootPath, requestPath);

  if (!filePath) {
    return reply.status(404).type('text/plain; charset=utf-8').send('Not found');
  }

  return serveStaticFile(filePath, reply);
}

function readRawPath(request: FastifyRequest, prefix: string): string | null {
  const rawPath = (request.raw.url ?? '').split('?')[0] ?? '';

  if (!rawPath.startsWith(prefix)) {
    return null;
  }

  return rawPath.slice(prefix.length);
}
