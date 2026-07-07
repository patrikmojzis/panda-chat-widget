import type { FastifyReply, FastifyRequest } from 'fastify';

import { findAuthContextBySessionToken } from './auth-data.ts';
import { parseSessionCookieHeader } from './auth-session.ts';
import type { AuthContext } from './auth-validation.ts';
import { verifyUnsafeRequestCsrf } from './csrf.ts';
import type { DatabaseClient } from './db.ts';

export type AuthErrorResponse = {
  error: 'unauthenticated';
};

export type CsrfErrorResponse = {
  error: 'csrf_protection_failed';
  reason: 'missing_csrf_protection' | 'cross_origin_request';
};

export function setNoStore(reply: FastifyReply): FastifyReply {
  return reply.header('cache-control', 'no-store');
}

export async function authenticateRequest(
  database: DatabaseClient,
  request: FastifyRequest,
  now: Date = new Date(),
): Promise<AuthContext | null> {
  const cookie = parseSessionCookieHeader(request.headers.cookie);

  if (cookie.status !== 'found') {
    return null;
  }

  return findAuthContextBySessionToken(database, cookie.token, now);
}

export async function requireAuthenticatedApi(
  database: DatabaseClient,
  request: FastifyRequest,
  reply: FastifyReply,
  now: Date = new Date(),
): Promise<AuthContext | null> {
  const auth = await authenticateRequest(database, request, now);

  if (!auth) {
    setNoStore(reply);
    await reply.status(401).send({ error: 'unauthenticated' } satisfies AuthErrorResponse);
    return null;
  }

  return auth;
}

export async function requireUnsafeRequestCsrf(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const csrf = verifyUnsafeRequestCsrf(request);

  if (csrf.allowed) {
    return true;
  }

  setNoStore(reply);
  await reply.status(403).send({
    error: 'csrf_protection_failed',
    reason: csrf.reason,
  } satisfies CsrfErrorResponse);

  return false;
}
