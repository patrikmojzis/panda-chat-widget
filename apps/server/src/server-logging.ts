import type { FastifyServerOptions } from 'fastify';

export type SafeLogError = {
  name: string;
};

export type DiagnosticCliError = SafeLogError & {
  code?: string;
  message?: string;
};

type SafeLoggerOptions = Exclude<FastifyServerOptions['logger'], undefined>;

type LoggableRequest = {
  method?: string;
  url?: string;
};

const PUBLIC_WIDGET_PATH_PREFIX = /^\/api\/widgets\/[^/]+/;
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const SAFE_ERROR_CODE = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 300;

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

export function diagnosticErrorForCli(error: unknown): DiagnosticCliError {
  if (!(error instanceof Error)) {
    return { name: 'Error' };
  }

  const diagnostic: DiagnosticCliError = safeErrorForLog(error);
  const code = errorCodeForLog(error);
  const message = sanitizeDiagnosticMessage(error.message);

  if (code !== undefined) {
    diagnostic.code = code;
  }

  if (message !== undefined) {
    diagnostic.message = message;
  }

  return diagnostic;
}

function errorCodeForLog(error: Error): string | undefined {
  const code = (error as { code?: unknown }).code;

  if (typeof code === 'string' && SAFE_ERROR_CODE.test(code)) {
    return code;
  }

  return undefined;
}

function sanitizeDiagnosticMessage(message: string): string | undefined {
  const sanitized = message
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+(@)/gi, '$1[redacted]$2')
    .replace(/([?&](?:password|token|key|secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) {
    return undefined;
  }

  return sanitized.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH);
}
