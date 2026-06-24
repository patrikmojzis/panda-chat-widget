import type { FastifyServerOptions } from 'fastify';

export type SafeLogError = {
  name: string;
};

type SafeLoggerOptions = Exclude<FastifyServerOptions['logger'], undefined>;

type LoggableRequest = {
  method?: string;
  url?: string;
};

const PUBLIC_WIDGET_PATH_PREFIX = /^\/api\/widgets\/[^/]+/;
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export function createSafeLoggerOptions(enabled: boolean): SafeLoggerOptions {
  if (!enabled) {
    return false;
  }

  return {
    level: 'info',
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.set-cookie',
      'req.body',
      'req.query',
    ],
    serializers: {
      req: serializeRequestForLog,
    },
  };
}

export type SerializedRequestLog = {
  method?: string;
  path?: string;
};

export function serializeRequestForLog(request: LoggableRequest): SerializedRequestLog {
  const log: SerializedRequestLog = {};

  if (request.method !== undefined) {
    log.method = request.method;
  }

  const path = redactRequestUrl(request.url);

  if (path !== undefined) {
    log.path = path;
  }

  return log;
}

export function redactRequestUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url, 'http://localhost');
    return parsed.pathname.replace(PUBLIC_WIDGET_PATH_PREFIX, '/api/widgets/:publicKey');
  } catch {
    return '[invalid-url]';
  }
}

export function safeErrorForLog(error: unknown): SafeLogError {
  if (!(error instanceof Error) || !SAFE_ERROR_NAME.test(error.name)) {
    return { name: 'Error' };
  }

  return { name: error.name };
}
