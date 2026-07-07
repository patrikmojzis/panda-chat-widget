import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLoginRequest, parseSetupRequest } from './auth-validation.ts';

test('setup validation normalizes email and workspace name while enforcing password and length limits', () => {
  assert.deepEqual(parseSetupRequest({
    email: ' OWNER@Example.TEST ',
    password: 'long-enough-password',
    workspaceName: ' Acme Support ',
  }), {
    status: 'valid',
    request: {
      email: 'owner@example.test',
      password: 'long-enough-password',
      workspaceName: 'Acme Support',
    },
  });

  assert.deepEqual(parseSetupRequest({ email: 'not-an-email', password: 'long-enough', workspaceName: 'Acme' }), {
    status: 'invalid',
    reason: 'invalid_email',
  });
  assert.deepEqual(parseSetupRequest({ email: 'owner@example.test', password: 'short', workspaceName: 'Acme' }), {
    status: 'invalid',
    reason: 'invalid_password',
  });
  assert.deepEqual(parseSetupRequest({
    email: 'owner@example.test',
    password: 'x'.repeat(129),
    workspaceName: 'Acme',
  }), {
    status: 'invalid',
    reason: 'invalid_password',
  });
  assert.deepEqual(parseSetupRequest({ email: 'owner@example.test', password: 'long-enough', workspaceName: '  ' }), {
    status: 'invalid',
    reason: 'invalid_workspace_name',
  });
  assert.deepEqual(parseSetupRequest({
    email: 'owner@example.test',
    password: 'long-enough',
    workspaceName: 'x'.repeat(101),
  }), {
    status: 'invalid',
    reason: 'invalid_workspace_name',
  });
});

test('login validation lowercases email and rejects malformed credentials before lookup', () => {
  assert.deepEqual(parseLoginRequest({ email: ' OWNER@Example.TEST ', password: 'long-enough' }), {
    status: 'valid',
    request: { email: 'owner@example.test', password: 'long-enough' },
  });
  assert.deepEqual(parseLoginRequest({ email: 'bad', password: 'long-enough' }), {
    status: 'invalid',
    reason: 'invalid_email',
  });
  assert.deepEqual(parseLoginRequest({ email: 'owner@example.test', password: 'short' }), {
    status: 'invalid',
    reason: 'invalid_password',
  });
});
