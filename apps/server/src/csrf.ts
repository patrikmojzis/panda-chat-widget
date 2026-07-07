import type { FastifyRequest } from 'fastify';

export type CsrfCheckResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: 'missing_csrf_protection' | 'cross_origin_request';
    };

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function verifyUnsafeRequestCsrf(request: FastifyRequest): CsrfCheckResult {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) {
    return { allowed: true };
  }

  if (request.headers['x-panda-csrf'] === '1') {
    return { allowed: true };
  }

  const origin = request.headers.origin;

  if (typeof origin !== 'string') {
    return { allowed: false, reason: 'missing_csrf_protection' };
  }

  if (!isSameOrigin(origin, request)) {
    return { allowed: false, reason: 'cross_origin_request' };
  }

  return { allowed: true };
}

function isSameOrigin(origin: string, request: FastifyRequest): boolean {
  const host = request.headers['x-forwarded-host'] ?? request.headers.host;

  if (Array.isArray(host) || typeof host !== 'string' || host.trim().length === 0) {
    return false;
  }

  const protoHeader = request.headers['x-forwarded-proto'];
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  const protocol = typeof proto === 'string' && proto.trim().length > 0
    ? (proto.trim().split(',')[0]?.trim() || 'http')
    : 'http';

  try {
    const parsedOrigin = new URL(origin);

    return parsedOrigin.origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}
