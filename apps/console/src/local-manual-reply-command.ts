export const DEFAULT_LOCAL_MANUAL_REPLY_TEXT = 'Hello from the protected console local reply';

export type LocalManualReplyScope = {
  siteId: string;
  widgetId: string;
  candidateId: string | null;
};

type LocalManualReplyState = {
  scope: LocalManualReplyScope;
  draft: string;
  command: string | null;
  copiedCommand: string | null;
  copyErrorCommand: string | null;
  latestCopyRequestId: number | null;
};

type LocalManualReplyCopyAction =
  | { type: 'copyStarted'; requestId: number; command: string }
  | { type: 'copySucceeded'; requestId: number; command: string }
  | { type: 'copyFailed'; requestId: number; command: string };

type LocalManualReplyAction =
  | { type: 'scopeChanged'; scope: LocalManualReplyScope }
  | { type: 'draftChanged'; draft: string }
  | LocalManualReplyCopyAction;

type ClipboardGetter = () => { writeText(text: string): Promise<void> } | undefined;

export function buildLocalManualReplyCommand(targetIntentId: string, replyText: string): string | null {
  const text = replyText.trim();

  if (!text) {
    return null;
  }

  const payload = JSON.stringify({ targetIntentId, reply: { text } });

  return `printf '%s\\n' '${payload.replaceAll("'", `'"'"'`)}' | pnpm --silent --filter @panda-chat-widget/server local-panda:reply-manual`;
}

export function createLocalManualReplyState(scope: LocalManualReplyScope): LocalManualReplyState {
  return {
    scope,
    draft: DEFAULT_LOCAL_MANUAL_REPLY_TEXT,
    command: scope.candidateId
      ? buildLocalManualReplyCommand(scope.candidateId, DEFAULT_LOCAL_MANUAL_REPLY_TEXT)
      : null,
    copiedCommand: null,
    copyErrorCommand: null,
    latestCopyRequestId: null,
  };
}

export function reduceLocalManualReplyState(
  state: LocalManualReplyState,
  action: LocalManualReplyAction,
): LocalManualReplyState {
  if (action.type === 'scopeChanged') {
    return sameScope(state.scope, action.scope) ? state : createLocalManualReplyState(action.scope);
  }

  if (action.type === 'draftChanged') {
    const command = state.scope.candidateId
      ? buildLocalManualReplyCommand(state.scope.candidateId, action.draft)
      : null;
    const commandChanged = command !== state.command;

    return {
      ...state,
      draft: action.draft,
      command,
      copiedCommand: commandChanged ? null : state.copiedCommand,
      copyErrorCommand: commandChanged ? null : state.copyErrorCommand,
    };
  }

  if (action.type === 'copyStarted') {
    if (action.command !== state.command) {
      return state;
    }

    return {
      ...state,
      copiedCommand: null,
      copyErrorCommand: null,
      latestCopyRequestId: action.requestId,
    };
  }

  if (action.type === 'copySucceeded') {
    if (action.command !== state.command) {
      return { ...state, copiedCommand: null };
    }

    return {
      ...state,
      copiedCommand: action.command,
      copyErrorCommand: null,
    };
  }

  if (action.requestId !== state.latestCopyRequestId || action.command !== state.command) {
    return state;
  }

  return {
    ...state,
    copiedCommand: null,
    copyErrorCommand: action.command,
  };
}

export function createLocalManualReplyCopyCoordinator() {
  let requestId = 0;
  const listeners = new Set<(action: LocalManualReplyCopyAction) => void>();

  function publish(action: LocalManualReplyCopyAction) {
    for (const listener of listeners) {
      listener(action);
    }
  }

  return {
    subscribe(listener: (action: LocalManualReplyCopyAction) => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    async copy(command: string, getClipboard: ClipboardGetter): Promise<boolean> {
      const currentRequestId = ++requestId;
      publish({ type: 'copyStarted', requestId: currentRequestId, command });
      let copied = false;

      try {
        const clipboard = getClipboard();

        if (clipboard) {
          await clipboard.writeText(command);
          copied = true;
        }
      } catch {
        // Clipboard access is optional; the reducer exposes manual-selection guidance.
      }

      publish({
        type: copied ? 'copySucceeded' : 'copyFailed',
        requestId: currentRequestId,
        command,
      });
      return copied;
    },
  };
}

export const localManualReplyCopyCoordinator = createLocalManualReplyCopyCoordinator();

function sameScope(left: LocalManualReplyScope, right: LocalManualReplyScope): boolean {
  return left.siteId === right.siteId && left.widgetId === right.widgetId && left.candidateId === right.candidateId;
}
