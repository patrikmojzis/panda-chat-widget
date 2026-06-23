import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from './config.ts';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values;
}

test('loadConfig uses local server defaults', () => {
  assert.deepEqual(loadConfig(env({})), {
    listen: {
      host: '127.0.0.1',
      port: 3000,
    },
    logger: true,
  });
});

test('loadConfig parses server environment overrides', () => {
  assert.deepEqual(loadConfig(env({ HOST: '0.0.0.0', PORT: '8080', SERVER_LOGGER: 'false' })), {
    listen: {
      host: '0.0.0.0',
      port: 8080,
    },
    logger: false,
  });
});

test('loadConfig trims HOST and PORT values', () => {
  assert.deepEqual(loadConfig(env({ HOST: ' localhost ', PORT: ' 4000 ', SERVER_LOGGER: '1' })), {
    listen: {
      host: 'localhost',
      port: 4000,
    },
    logger: true,
  });
});

test('loadConfig rejects invalid PORT values', () => {
  for (const port of ['', '0', '65536', '3000.5', '-1', 'abc']) {
    assert.throws(
      () => loadConfig(env({ PORT: port })),
      /Invalid PORT: expected an integer from 1 to 65535/,
    );
  }
});

test('loadConfig rejects blank HOST', () => {
  assert.throws(
    () => loadConfig(env({ HOST: ' ' })),
    /Invalid HOST: expected a non-empty host/,
  );
});

test('loadConfig rejects invalid SERVER_LOGGER values', () => {
  assert.throws(
    () => loadConfig(env({ SERVER_LOGGER: 'sometimes' })),
    /Invalid SERVER_LOGGER: expected true, false, 1, or 0/,
  );
});
