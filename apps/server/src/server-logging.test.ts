import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createSafeLoggerOptions,
  redactRequestUrl,
  safeErrorForLog,
  serializeRequestForLog,
} from './server-logging.ts';

const appSource = await readFile(new URL('./app.ts', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('./main.ts', import.meta.url), 'utf8');
const serverRuntimeSource = await readFile(new URL('./server-runtime.ts', import.meta.url), 'utf8');
const migrateSource = await readFile(new URL('./migrate.ts', import.meta.url), 'utf8');
const seedSource = await readFile(new URL('./seed.ts', import.meta.url), 'utf8');
const routeSources = await Promise.all([
  readFile(new URL('./widget-bootstrap.ts', import.meta.url), 'utf8'),
  readFile(new URL('./visitor-session.ts', import.meta.url), 'utf8'),
  readFile(new URL('./conversation.ts', import.meta.url), 'utf8'),
  readFile(new URL('./visitor-message.ts', import.meta.url), 'utf8'),
]);
const serverProductSource = [appSource, mainSource, serverRuntimeSource, migrateSource, seedSource, ...routeSources].join('\n');

test('safe request logger drops public widget keys and query params', () => {
  assert.equal(
    redactRequestUrl('/api/widgets/demo-local-widget/messages?visitorSessionId=visitor-secret&body=hello'),
    '/api/widgets/:publicKey/messages',
  );
  assert.equal(
    redactRequestUrl('https://host.example/api/widgets/public-token/messages/events?conversationId=secret'),
    '/api/widgets/:publicKey/messages/events',
  );
  assert.equal(redactRequestUrl('/healthz?token=secret'), '/healthz');
  assert.deepEqual(serializeRequestForLog({ method: 'GET', url: '/api/widgets/public-token/bootstrap' }), {
    method: 'GET',
    path: '/api/widgets/:publicKey/bootstrap',
  });
});

test('safe error logger does not keep messages, stacks, or raw thrown values', () => {
  const error = new Error('visitor-key secret, message body secret, public token secret');
  error.name = 'DatabaseError';

  assert.deepEqual(safeErrorForLog(error), { name: 'DatabaseError' });
  assert.deepEqual(safeErrorForLog('plain secret string'), { name: 'Error' });
  assert.doesNotMatch(JSON.stringify(safeErrorForLog(error)), /visitor-key|message body|public token|stack|secret/i);
});

test('logger=true uses safe request serialization and sensitive header redaction', () => {
  const loggerOptions = createSafeLoggerOptions(true);

  assert.equal(createSafeLoggerOptions(false), false);
  assert.equal(typeof loggerOptions, 'object');

  if (!loggerOptions || typeof loggerOptions !== 'object' || !('serializers' in loggerOptions)) {
    throw new Error('expected safe logger options object');
  }

  assert.equal(loggerOptions.serializers?.req, serializeRequestForLog);
  assert.deepEqual(serializeRequestForLog({
    method: 'POST',
    url: '/api/widgets/public-token/messages?visitorSessionId=secret',
  }), {
    method: 'POST',
    path: '/api/widgets/:publicKey/messages',
  });
  assert.deepEqual(loggerOptions.redact, [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers.set-cookie',
    'req.body',
    'req.query',
  ]);
});

test('server logging source avoids raw visitor keys, public tokens, and message bodies', () => {
  assert.match(appSource, /createSafeLoggerOptions\(true\)/);
  assert.match(appSource, /safeErrorForLog\(error\)/);
  assert.match(serverRuntimeSource, /safeErrorForLog\(error\)/);
  assert.match(migrateSource, /safeErrorForLog\(error\)/);
  assert.match(seedSource, /safeErrorForLog\(error\)/);
  assert.doesNotMatch(serverProductSource, /console\.error\(error\)|\{\s*err:\s*error\s*\}/);
  assert.doesNotMatch(seedSource, /result\.publicWidgetKey|allowedDomains\.join/);
  const logLines = serverProductSource
    .split('\n')
    .filter((line) => /\.log\.(?:trace|debug|info|warn|error)\(/.test(line));

  assert.deepEqual(logLines, [
    "    request.log.error({ error: safeErrorForLog(error) }, 'request failed');",
    "    app.log.error({ error: safeErrorForLog(error) }, 'server failed to start');",
    "    app.log.error({ error: safeErrorForLog(error) }, 'server cleanup failed after start failure');",
  ]);
  assert.doesNotMatch(logLines.join('\n'), /visitorKey|visitor_key|publicKey|body|request\.body|message/i);
});
