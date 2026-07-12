import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { buildLocalManualReplyCommand, reduceLocalManualReplyCopyState } from '../src/local-manual-reply-command.ts';

const invocation = ' | pnpm --silent --filter @panda-chat-widget/server local-panda:reply-manual';

test('builds the exact targeted local manual reply command', () => {
  assert.equal(
    buildLocalManualReplyCommand('candidate-id'),
    `printf '%s\\n' '{"targetIntentId":"candidate-id","reply":{"text":"Hello from the protected console local reply"}}'${invocation}`,
  );
});

test('shell-quotes the candidate ID and emits only the allowlisted reply payload', () => {
  const targetIntentId = `candidate-'$(printf injected)`;
  const command = buildLocalManualReplyCommand(targetIntentId);

  assert.ok(command.endsWith(invocation));
  const printedPayload = execFileSync('/bin/sh', ['-c', command.slice(0, -invocation.length)]);

  assert.equal(printedPayload.at(-1), 0x0a);
  assert.deepEqual(JSON.parse(printedPayload.toString('utf8')), {
    targetIntentId,
    reply: { text: 'Hello from the protected console local reply' },
  });
});


test('resets copied state across candidate changes and ignores stale clipboard completion', async () => {
  let state = reduceLocalManualReplyCopyState(
    { candidateId: null, copiedCandidateId: null },
    { type: 'candidateChanged', candidateId: 'candidate-a' },
  );
  let finishCandidateACopy;
  const candidateACopy = new Promise((resolve) => {
    finishCandidateACopy = resolve;
  }).then(() => {
    state = reduceLocalManualReplyCopyState(state, { type: 'copyCompleted', candidateId: 'candidate-a' });
  });

  state = reduceLocalManualReplyCopyState(state, { type: 'candidateChanged', candidateId: 'candidate-b' });
  finishCandidateACopy();
  await candidateACopy;
  assert.deepEqual(state, { candidateId: 'candidate-b', copiedCandidateId: null });

  state = reduceLocalManualReplyCopyState(state, { type: 'copyCompleted', candidateId: 'candidate-b' });
  assert.deepEqual(state, { candidateId: 'candidate-b', copiedCandidateId: 'candidate-b' });

  state = reduceLocalManualReplyCopyState(state, { type: 'candidateChanged', candidateId: null });
  assert.deepEqual(state, { candidateId: null, copiedCandidateId: null });
});
