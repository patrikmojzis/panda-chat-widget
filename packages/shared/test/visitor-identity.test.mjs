import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as ts from 'typescript';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const visitorIdentitySource = await readFile(new URL('../src/visitor-identity.ts', import.meta.url), 'utf8');

function compileTypeScript(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function loadModule(compiledSource) {
  const module = { exports: {} };

  vm.runInNewContext(
    compiledSource,
    {
      encodeURIComponent,
      exports: module.exports,
      module,
    },
    { timeout: 1000 },
  );

  return module.exports;
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

const visitorIdentity = loadModule(compileTypeScript(visitorIdentitySource));

test('shared package runs visitor identity contract tests', () => {
  assert.equal(packageJson.scripts.test, 'node --test "test/**/*.test.mjs"');
  assert.match(visitorIdentitySource, /export type VisitorSessionCreateRequest = \{\n  visitorKey: VisitorKey;/);
  assert.match(visitorIdentitySource, /export type VisitorSessionCreateResponse = \{[\s\S]*visitorSession:/);
  assert.match(visitorIdentitySource, /export type VisitorSessionReference = \{\n  visitorSessionId: VisitorSessionId;/);
});

test('visitor identity contract keeps opaque client storage separate from server session ids', () => {
  assert.deepEqual(jsonSafe(visitorIdentity.VISITOR_IDENTITY_CONTRACT), {
    persistenceOwner: 'iframe_local_storage',
    storageKeyPrefix: 'panda-chat-widget:visitor-key:v1:',
    serverSession: {
      method: 'POST',
      path: '/api/widgets/:publicKey/visitor-session',
      requestBody: 'VisitorSessionCreateRequest',
      responseBody: 'VisitorSessionCreateResponse',
    },
    conversation: {
      requestReference: 'VisitorSessionReference',
    },
  });
  assert.equal(visitorIdentity.VISITOR_KEY_PREFIX, 'pvk_');
  assert.equal(visitorIdentity.VISITOR_KEY_RANDOM_BYTES, 32);
  assert.equal(visitorIdentity.VISITOR_KEY_RANDOM_PART_LENGTH, 43);
});

test('visitor storage key is deterministic and scoped by widget public key', () => {
  assert.equal(
    visitorIdentity.buildVisitorKeyStorageKey('demo-local-widget'),
    'panda-chat-widget:visitor-key:v1:demo-local-widget',
  );
  assert.equal(
    visitorIdentity.buildVisitorKeyStorageKey('demo key/with?chars'),
    'panda-chat-widget:visitor-key:v1:demo%20key%2Fwith%3Fchars',
  );
});

test('visitor key parser accepts only opaque random-looking keys', () => {
  const visitorKey = `pvk_${'A'.repeat(43)}`;

  assert.deepEqual(jsonSafe(visitorIdentity.parseVisitorKey(visitorKey)), {
    status: 'valid',
    visitorKey,
  });
  assert.deepEqual(jsonSafe(visitorIdentity.parseVisitorKey(` ${visitorKey} `)), {
    status: 'valid',
    visitorKey,
  });

  assert.deepEqual(jsonSafe(visitorIdentity.parseVisitorKey(undefined)), {
    status: 'invalid',
    reason: 'not_string',
  });
  assert.deepEqual(jsonSafe(visitorIdentity.parseVisitorKey('   ')), {
    status: 'invalid',
    reason: 'empty',
  });

  for (const invalidVisitorKey of [
    'visitor@example.test',
    'pvk_short',
    `pvk_${'A'.repeat(42)}`,
    `pvk_${'A'.repeat(44)}`,
    `pvk_${'<script>'.padEnd(43, 'A')}`,
  ]) {
    assert.deepEqual(jsonSafe(visitorIdentity.parseVisitorKey(invalidVisitorKey)), {
      status: 'invalid',
      reason: 'invalid_format',
    });
  }
});

test('visitor identity seam does not use fingerprinting inputs or storage side effects yet', () => {
  assert.doesNotMatch(
    visitorIdentitySource,
    /navigator|userAgent|document\.cookie|localStorage\.|sessionStorage\.|canvas|screen\.|hardwareConcurrency|platform/i,
  );
  assert.doesNotMatch(visitorIdentitySource, /fetch\(|postMessage|EventSource|WebSocket/i);
});
