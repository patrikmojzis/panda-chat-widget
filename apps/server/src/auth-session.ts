import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'pcw_session';
export const SESSION_TOKEN_BYTES = 32;
export const SESSION_TOKEN_LENGTH = 43;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const COOKIE_PAIR_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+=[^;\r\n]*$/;

export type SessionCookieParseResult =
  | {
      status: 'found';
      token: string;
    }
  | {
      status: 'missing';
    }
  | {
      status: 'invalid';
      reason: 'multiple_cookie_headers' | 'malformed_cookie' | 'duplicate_session_cookie' | 'invalid_session_token';
    };

export type SessionCookieOptions = {
  secure: boolean;
};

export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export function parseSessionCookieHeader(header: string | string[] | undefined): SessionCookieParseResult {
  if (header === undefined) {
    return { status: 'missing' };
  }

  if (Array.isArray(header)) {
    return { status: 'invalid', reason: 'multiple_cookie_headers' };
  }

  if (header.trim().length === 0) {
    return { status: 'missing' };
  }

  let sessionToken: string | null = null;

  for (const rawPart of header.split(';')) {
    const part = rawPart.trim();

    if (!part) {
      return { status: 'invalid', reason: 'malformed_cookie' };
    }

    if (!COOKIE_PAIR_PATTERN.test(part)) {
      return { status: 'invalid', reason: 'malformed_cookie' };
    }

    const separatorIndex = part.indexOf('=');
    const name = part.slice(0, separatorIndex);
    const value = part.slice(separatorIndex + 1);

    if (name !== SESSION_COOKIE_NAME) {
      continue;
    }

    if (sessionToken !== null) {
      return { status: 'invalid', reason: 'duplicate_session_cookie' };
    }

    sessionToken = value;
  }

  if (sessionToken === null) {
    return { status: 'missing' };
  }

  if (!SESSION_TOKEN_PATTERN.test(sessionToken)) {
    return { status: 'invalid', reason: 'invalid_session_token' };
  }

  return { status: 'found', token: sessionToken };
}

export function serializeSessionCookie(token: string, options: SessionCookieOptions): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];

  if (options.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

export function serializeSessionCookieClear(options: SessionCookieOptions): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
  ];

  if (options.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}
