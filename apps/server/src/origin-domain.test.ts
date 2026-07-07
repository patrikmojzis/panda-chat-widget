import assert from 'node:assert/strict';
import test from 'node:test';

import { DEMO_SEED_DATA } from './seed-data.ts';
import {
  matchOriginToAllowedDomains,
  normalizeAllowedDomainInput,
  type AllowedDomainRecord,
} from './origin-domain.ts';

const seedAllowedDomains = DEMO_SEED_DATA.allowedDomains.map((domain) => ({
  domain,
  enabled: true,
})) satisfies AllowedDomainRecord[];

test('normalizeAllowedDomainInput stores bare hostnames lowercased without ports', () => {
  assert.deepEqual(normalizeAllowedDomainInput(' Example.COM '), {
    status: 'valid',
    domain: 'example.com',
  });
  assert.deepEqual(normalizeAllowedDomainInput('localhost'), {
    status: 'valid',
    domain: 'localhost',
  });
  assert.deepEqual(normalizeAllowedDomainInput('127.0.0.1'), {
    status: 'valid',
    domain: '127.0.0.1',
  });
});

test('normalizeAllowedDomainInput accepts schemeful http(s) origins and stores hostname only', () => {
  assert.deepEqual(normalizeAllowedDomainInput('https://Example.com:443'), {
    status: 'valid',
    domain: 'example.com',
  });
  assert.deepEqual(normalizeAllowedDomainInput('http://LOCALHOST:5173'), {
    status: 'valid',
    domain: 'localhost',
  });
});

test('normalizeAllowedDomainInput rejects bare host ports and non-host origins before storage', () => {
  for (const value of [
    undefined,
    null,
    '',
    '   ',
    'localhost:5173',
    'example.com:443',
    'ftp://example.com',
    'https://example.com/path',
    'https://example.com?x=1',
    'https://user:pass@example.com',
    '*.example.com',
    'bad host.example',
    '999.999.999.999',
    '<script>alert(1)</script>',
  ]) {
    assert.equal(normalizeAllowedDomainInput(value).status, 'invalid', `expected ${String(value)} to be invalid`);
  }
});

test('matchOriginToAllowedDomains allows seeded localhost origins with ports', () => {
  assert.deepEqual(matchOriginToAllowedDomains('http://localhost:5173', seedAllowedDomains), {
    allowed: true,
    origin: 'http://localhost:5173',
    hostname: 'localhost',
    domain: 'localhost',
  });
});

test('matchOriginToAllowedDomains allows seeded 127.0.0.1 origins with ports', () => {
  assert.deepEqual(matchOriginToAllowedDomains('http://127.0.0.1:3000', seedAllowedDomains), {
    allowed: true,
    origin: 'http://127.0.0.1:3000',
    hostname: '127.0.0.1',
    domain: '127.0.0.1',
  });
});

test('matchOriginToAllowedDomains compares hostnames case-insensitively', () => {
  assert.deepEqual(matchOriginToAllowedDomains('HTTP://LOCALHOST:5173', seedAllowedDomains), {
    allowed: true,
    origin: 'http://localhost:5173',
    hostname: 'localhost',
    domain: 'localhost',
  });
});

test('matchOriginToAllowedDomains ignores disabled allowed-domain records', () => {
  assert.deepEqual(matchOriginToAllowedDomains('http://localhost:5173', [{ domain: 'localhost', enabled: false }]), {
    allowed: false,
    reason: 'domain_not_allowed',
  });
});

test('matchOriginToAllowedDomains rejects disallowed origins', () => {
  assert.deepEqual(matchOriginToAllowedDomains('https://example.com', seedAllowedDomains), {
    allowed: false,
    reason: 'domain_not_allowed',
  });
});

test('matchOriginToAllowedDomains does not wildcard subdomains', () => {
  assert.deepEqual(matchOriginToAllowedDomains('http://sub.localhost:5173', seedAllowedDomains), {
    allowed: false,
    reason: 'domain_not_allowed',
  });
});

test('matchOriginToAllowedDomains rejects missing origins by default', () => {
  for (const origin of [undefined, null, '']) {
    assert.deepEqual(matchOriginToAllowedDomains(origin, seedAllowedDomains), {
      allowed: false,
      reason: 'missing_origin',
    });
  }
});

test('matchOriginToAllowedDomains rejects malformed origins', () => {
  for (const origin of ['not a url', 'ftp://localhost', 'http://localhost/path', 'http://user:pass@localhost']) {
    assert.deepEqual(matchOriginToAllowedDomains(origin, seedAllowedDomains), {
      allowed: false,
      reason: 'invalid_origin',
    });
  }
});
