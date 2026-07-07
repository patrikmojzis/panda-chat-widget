import assert from 'node:assert/strict';
import test from 'node:test';

import { hashPassword, verifyPassword } from './auth-password.ts';
import {
  createSessionToken,
  hashSessionToken,
  parseSessionCookieHeader,
  serializeSessionCookie,
  SESSION_TOKEN_BYTES,
  SESSION_TOKEN_LENGTH,
} from './auth-session.ts';

test('session tokens are at least 32 random bytes encoded as base64url and only hashes are stored', () => {
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);

  assert.equal(SESSION_TOKEN_BYTES, 32);
  assert.equal(SESSION_TOKEN_LENGTH, 43);
  assert.equal(token.length, SESSION_TOKEN_LENGTH);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(tokenHash, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(tokenHash, token);
});

test('strict session cookie parser accepts one valid session cookie only', () => {
  const token = 'A'.repeat(43);

  assert.deepEqual(parseSessionCookieHeader(undefined), { status: 'missing' });
  assert.deepEqual(parseSessionCookieHeader('other=value'), { status: 'missing' });
  assert.deepEqual(parseSessionCookieHeader(`pcw_session=${token}`), { status: 'found', token });
  assert.deepEqual(parseSessionCookieHeader(` other=value ; pcw_session=${token} `), { status: 'found', token });

  assert.deepEqual(parseSessionCookieHeader(['pcw_session=A']), {
    status: 'invalid',
    reason: 'multiple_cookie_headers',
  });
  assert.deepEqual(parseSessionCookieHeader(`pcw_session=${token}; pcw_session=${token}`), {
    status: 'invalid',
    reason: 'duplicate_session_cookie',
  });
  assert.deepEqual(parseSessionCookieHeader('pcw_session=short'), {
    status: 'invalid',
    reason: 'invalid_session_token',
  });
  assert.deepEqual(parseSessionCookieHeader(`pcw_session=${token}; broken`), {
    status: 'invalid',
    reason: 'malformed_cookie',
  });
});

test('session cookie serialization sets HttpOnly SameSite Lax path max-age and optional Secure', () => {
  const token = 'A'.repeat(43);

  assert.equal(
    serializeSessionCookie(token, { secure: false }),
    `pcw_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
  );
  assert.equal(
    serializeSessionCookie(token, { secure: true }),
    `pcw_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure`,
  );
});

test('password hashes are salted self-describing scrypt values and verify without exposing password text', async () => {
  const password = 'correct horse battery staple';
  const passwordHash = await hashPassword(password);

  assert.match(passwordHash, /^scrypt\$v1\$n=16384,r=8,p=1,key=32\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(passwordHash, /correct|horse|battery|staple/);
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword('wrong password', passwordHash), false);
  assert.equal(await verifyPassword(password, 'not-a-valid-hash'), false);
});
