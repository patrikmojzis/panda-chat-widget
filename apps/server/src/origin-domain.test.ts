import assert from 'node:assert/strict';
import test from 'node:test';

import { DEMO_SEED_DATA } from './seed-data.ts';
import { matchOriginToAllowedDomains, type AllowedDomainRecord } from './origin-domain.ts';

const seedAllowedDomains = DEMO_SEED_DATA.allowedDomains.map((domain) => ({
  domain,
  enabled: true,
})) satisfies AllowedDomainRecord[];

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
