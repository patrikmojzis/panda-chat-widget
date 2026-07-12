import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_LOCAL_MANUAL_REPLY_TEXT,
  buildLocalManualReplyCommand,
  createLocalManualReplyCopyCoordinator,
  createLocalManualReplyState,
  reduceLocalManualReplyState,
} from '../src/local-manual-reply-command.ts';

const invocation = ' | pnpm --silent --filter @panda-chat-widget/server local-panda:reply-manual';
const scope = (candidateId, siteId = 'site-a', widgetId = 'widget-a') => ({ siteId, widgetId, candidateId });

function printedPayload(command) {
  assert.ok(command.endsWith(invocation));
  return execFileSync('/bin/sh', ['-c', command.slice(0, -invocation.length)]);
}

test('builds default and custom commands from trimmed reply text with an exact allowlisted payload', () => {
  const defaultCommand = buildLocalManualReplyCommand('candidate-id', DEFAULT_LOCAL_MANUAL_REPLY_TEXT);
  assert.equal(
    defaultCommand,
    `printf '%s\\n' '{"targetIntentId":"candidate-id","reply":{"text":"Hello from the protected console local reply"}}'${invocation}`,
  );

  const customPayload = JSON.parse(printedPayload(buildLocalManualReplyCommand('candidate-id', '  Custom reply  ')));
  assert.deepEqual(customPayload, { targetIntentId: 'candidate-id', reply: { text: 'Custom reply' } });
  assert.deepEqual(Object.keys(customPayload), ['targetIntentId', 'reply']);
  assert.deepEqual(Object.keys(customPayload.reply), ['text']);
  assert.equal(buildLocalManualReplyCommand('candidate-id', ' \r\n\t '), null);
});

test('shell-quotes adversarial reply text without interpolation and keeps CR/LF JSON-encoded on one shell line', () => {
  const directory = mkdtempSync(join(tmpdir(), 'panda-local-reply-'));
  const marker = join(directory, 'interpolated');
  const replyText = `  apostrophe ' $HOME $(touch ${marker}) \`touch ${marker}\` backslash \\ line\r\nnext 😀 Žluťoučký  `;

  try {
    const command = buildLocalManualReplyCommand(`candidate-'$(touch ${marker})`, replyText);
    assert.ok(command);
    assert.doesNotMatch(command, /[\r\n]/);
    assert.match(command, /\\r\\n/);

    const output = printedPayload(command);
    assert.equal(output.at(-1), 0x0a);
    assert.deepEqual(JSON.parse(output.toString('utf8')), {
      targetIntentId: `candidate-'$(touch ${marker})`,
      reply: { text: replyText.trim() },
    });
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('scopes the exact raw draft to site, widget, and candidate without stale transition data', () => {
  let state = createLocalManualReplyState(scope('candidate-a'));
  state = reduceLocalManualReplyState(state, { type: 'draftChanged', draft: '  raw A draft  ' });
  const sameCandidate = reduceLocalManualReplyState(state, { type: 'scopeChanged', scope: scope('candidate-a') });
  assert.strictEqual(sameCandidate, state, 'same-candidate refresh preserves the exact state');
  assert.equal(state.draft, '  raw A draft  ');

  state = reduceLocalManualReplyState(state, { type: 'scopeChanged', scope: scope('candidate-b') });
  assert.equal(state.draft, DEFAULT_LOCAL_MANUAL_REPLY_TEXT);
  assert.equal(state.command.includes('raw A draft'), false);
  assert.match(state.command, /candidate-b/);

  state = reduceLocalManualReplyState(state, { type: 'draftChanged', draft: 'candidate B draft' });
  state = reduceLocalManualReplyState(state, { type: 'scopeChanged', scope: scope(null) });
  assert.equal(state.draft, DEFAULT_LOCAL_MANUAL_REPLY_TEXT);
  assert.equal(state.command, null);

  state = reduceLocalManualReplyState(state, { type: 'scopeChanged', scope: scope('candidate-a') });
  state = reduceLocalManualReplyState(state, { type: 'draftChanged', draft: 'new A draft' });
  state = reduceLocalManualReplyState(state, {
    type: 'scopeChanged',
    scope: scope('candidate-a', 'site-b', 'widget-b'),
  });
  assert.equal(state.draft, DEFAULT_LOCAL_MANUAL_REPLY_TEXT);
  assert.equal(state.scope.siteId, 'site-b');
  assert.equal(state.scope.widgetId, 'widget-b');
});

test('uses the exact generated command as copied-state identity', () => {
  let state = createLocalManualReplyState(scope('candidate-a'));
  state = reduceLocalManualReplyState(state, { type: 'draftChanged', draft: 'Reply' });
  const command = state.command;
  state = reduceLocalManualReplyState(state, { type: 'copyStarted', requestId: 1, command });
  state = reduceLocalManualReplyState(state, { type: 'copySucceeded', requestId: 1, command });
  assert.equal(state.copiedCommand, command);

  state = reduceLocalManualReplyState(state, { type: 'draftChanged', draft: ' \n Reply \t' });
  assert.equal(state.command, command);
  assert.equal(state.copiedCommand, command);

  state = reduceLocalManualReplyState(state, { type: 'draftChanged', draft: 'Different reply' });
  assert.notEqual(state.command, command);
  assert.equal(state.copiedCommand, null);
});

test('handles unavailable, throwing-getter, and rejected clipboards without throwing', async () => {
  const coordinator = createLocalManualReplyCopyCoordinator();
  assert.equal(await coordinator.copy('command', () => undefined), false);
  assert.equal(
    await coordinator.copy('command', () => {
      throw new Error('clipboard getter denied');
    }),
    false,
  );
  assert.equal(
    await coordinator.copy('command', () => ({
      writeText: async () => {
        throw new Error('write denied');
      },
    })),
    false,
  );
  assert.equal(
    await coordinator.copy('command', () => ({ writeText: async () => undefined })),
    true,
  );
});


test('shared coordinator fails closed across an unmount and fresh remount', async () => {
  const coordinator = createLocalManualReplyCopyCoordinator();
  let oldState = createLocalManualReplyState(scope('candidate-a'));
  oldState = reduceLocalManualReplyState(oldState, { type: 'draftChanged', draft: 'delayed A' });
  const commandA = oldState.command;
  const unsubscribeOld = coordinator.subscribe((action) => {
    oldState = reduceLocalManualReplyState(oldState, action);
  });
  let finishA;
  const pendingA = coordinator.copy(commandA, () => ({
    writeText: () => new Promise((resolve) => {
      finishA = resolve;
    }),
  }));

  unsubscribeOld();
  let currentState = createLocalManualReplyState(scope('candidate-a'));
  const commandB = currentState.command;
  const unsubscribeCurrent = coordinator.subscribe((action) => {
    currentState = reduceLocalManualReplyState(currentState, action);
  });

  assert.equal(
    await coordinator.copy(commandB, () => ({ writeText: async () => undefined })),
    true,
  );
  assert.equal(currentState.copiedCommand, commandB);

  finishA();
  assert.equal(await pendingA, true);
  assert.equal(currentState.copiedCommand, null);
  unsubscribeCurrent();
});


test('shared coordinator reports a throwing clipboard getter as the current command failure', async () => {
  const coordinator = createLocalManualReplyCopyCoordinator();
  let state = createLocalManualReplyState(scope('candidate-a'));
  const command = state.command;
  const unsubscribe = coordinator.subscribe((action) => {
    state = reduceLocalManualReplyState(state, action);
  });

  assert.equal(
    await coordinator.copy(command, () => {
      throw new Error('clipboard getter denied');
    }),
    false,
  );
  assert.equal(state.copiedCommand, null);
  assert.equal(state.copyErrorCommand, command);
  unsubscribe();
});

test('fails closed when an older successful write finishes after the current command', () => {
  let state = createLocalManualReplyState(scope('candidate-a'));
  state = reduceLocalManualReplyState(state, { type: 'draftChanged', draft: 'command A' });
  const commandA = state.command;
  state = reduceLocalManualReplyState(state, { type: 'copyStarted', requestId: 1, command: commandA });

  state = reduceLocalManualReplyState(state, { type: 'draftChanged', draft: 'command B' });
  const commandB = state.command;
  state = reduceLocalManualReplyState(state, { type: 'copyStarted', requestId: 2, command: commandB });
  state = reduceLocalManualReplyState(state, { type: 'copySucceeded', requestId: 2, command: commandB });
  assert.equal(state.copiedCommand, commandB);

  state = reduceLocalManualReplyState(state, { type: 'copySucceeded', requestId: 1, command: commandA });
  assert.equal(state.copiedCommand, null);

  const beforeStaleFailure = state;
  state = reduceLocalManualReplyState(state, { type: 'copyFailed', requestId: 1, command: commandA });
  assert.strictEqual(state, beforeStaleFailure);

  state = reduceLocalManualReplyState(state, { type: 'copyStarted', requestId: 3, command: commandB });
  state = reduceLocalManualReplyState(state, { type: 'copyFailed', requestId: 3, command: commandB });
  assert.equal(state.copiedCommand, null);
  assert.equal(state.copyErrorCommand, commandB);
});
