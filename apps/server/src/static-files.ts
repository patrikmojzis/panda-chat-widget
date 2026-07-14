import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { FastifyReply } from 'fastify';

export function resolveStaticFile(rootPath: string, requestPath: string): string | null {
  let decodedPath: string;

  try {
    decodedPath = decodeURIComponent(requestPath.replace(/^\/+/, ''));
  } catch {
    return null;
  }

  if (decodedPath.includes('\0') || decodedPath.includes('\\')) {
    return null;
  }

  const segments = decodedPath.split('/');

  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null;
  }

  const root = path.resolve(rootPath);
  const filePath = path.resolve(root, ...segments);
  const relativePath = path.relative(root, filePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return filePath;
}

export async function serveStaticFile(
  filePath: string,
  reply: FastifyReply,
  contentType = contentTypeForPath(filePath),
): Promise<FastifyReply> {
  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      return notFound(reply);
    }

    return reply
      .header('content-length', fileStat.size)
      .type(contentType)
      .send(createReadStream(filePath));
  } catch (error) {
    if (isMissingFileError(error)) {
      return notFound(reply);
    }

    throw error;
  }
}

export function contentTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
    case '.map':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply.status(404).type('text/plain; charset=utf-8').send('Not found');
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR'),
  );
}
