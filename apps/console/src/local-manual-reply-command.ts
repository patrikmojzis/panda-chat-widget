export function buildLocalManualReplyCommand(targetIntentId: string): string {
  const payload = JSON.stringify({
    targetIntentId,
    reply: { text: 'Hello from the protected console local reply' },
  });

  return `printf '%s\\n' '${payload.replaceAll("'", `'"'"'`)}' | pnpm --silent --filter @panda-chat-widget/server local-panda:reply-manual`;
}


type LocalManualReplyCopyState = {
  candidateId: string | null;
  copiedCandidateId: string | null;
};

type LocalManualReplyCopyAction =
  | { type: 'candidateChanged'; candidateId: string | null }
  | { type: 'copyCompleted'; candidateId: string };

export function reduceLocalManualReplyCopyState(
  state: LocalManualReplyCopyState,
  action: LocalManualReplyCopyAction,
): LocalManualReplyCopyState {
  if (action.type === 'candidateChanged') {
    return { candidateId: action.candidateId, copiedCandidateId: null };
  }

  return action.candidateId === state.candidateId
    ? { ...state, copiedCandidateId: action.candidateId }
    : state;
}
