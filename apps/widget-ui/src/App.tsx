import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  applyWidgetChatMessage,
  createWidgetChatMessagesState,
  createWidgetClientMessageId,
  createWidgetConversation,
  createWidgetVisitorSession,
  listWidgetMessages,
  sendWidgetMessage,
  subscribeToWidgetMessages,
  type WidgetChatMessagesState,
  type WidgetConversationMessage,
  type WidgetMessageSubscription,
} from './widget-chat';
import {
  loadWidgetBootstrap,
  type WidgetBootstrapLoadState,
  type WidgetBootstrapResponse,
} from './widget-bootstrap';
import { resolveWidgetComposerKeyAction } from './widget-composer';
import type { WidgetPublicKeyState } from './widget-public-key';
import { resolveWidgetTheme } from './widget-theme';
import { getOrCreateWidgetVisitorKey } from './widget-visitor-identity';

type AppProps = {
  widgetPublicKey: WidgetPublicKeyState;
  bootstrapBaseHref: string;
};

type WidgetChatState =
  | {
      status: 'loading';
    }
  | {
      status: 'ready';
      visitorSessionId: string;
      conversationId: string;
      messageState: WidgetChatMessagesState;
      sendStatus: 'idle' | 'sending' | 'error';
    }
  | {
      status: 'error';
    };

function publicKeyFromState(widgetPublicKey: WidgetPublicKeyState): string | null {
  return widgetPublicKey.status === 'configured' ? widgetPublicKey.publicKey : null;
}

function initialBootstrapState(publicKey: string | null): WidgetBootstrapLoadState {
  return publicKey ? { status: 'loading' } : { status: 'missing_key' };
}

export function App({ widgetPublicKey, bootstrapBaseHref }: AppProps) {
  const publicKey = publicKeyFromState(widgetPublicKey);
  const [bootstrapState, setBootstrapState] = useState<WidgetBootstrapLoadState>(() =>
    initialBootstrapState(publicKey),
  );

  useEffect(() => {
    let isCurrent = true;

    if (!publicKey) {
      setBootstrapState({ status: 'missing_key' });
      return () => {
        isCurrent = false;
      };
    }

    setBootstrapState({ status: 'loading' });

    void loadWidgetBootstrap(publicKey, { baseHref: bootstrapBaseHref }).then((nextState) => {
      if (isCurrent) {
        setBootstrapState(nextState);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [bootstrapBaseHref, publicKey]);

  return (
    <main className="widget-shell" aria-label="Panda chat widget" data-state={bootstrapState.status}>
      <p className="widget-shell__eyebrow">Panda Chat Widget</p>
      <BootstrapPlaceholder state={bootstrapState} bootstrapBaseHref={bootstrapBaseHref} />
    </main>
  );
}

type BootstrapPlaceholderProps = {
  state: WidgetBootstrapLoadState;
  bootstrapBaseHref: string;
};

type WidgetStateMessageProps = {
  tone: 'loading' | 'empty' | 'error';
  title: string;
  body: string;
  role?: 'status' | 'alert';
  action?: ReactNode;
};

function BootstrapPlaceholder({ state, bootstrapBaseHref }: BootstrapPlaceholderProps) {
  if (state.status === 'missing_key') {
    return <WidgetStateMessage tone="error" title="Chat is not ready" body="Please try again later." role="alert" />;
  }

  if (state.status === 'loading') {
    return <WidgetStateMessage tone="loading" title="Loading chat…" body="This should only take a moment." />;
  }

  if (state.status === 'error') {
    return <WidgetStateMessage tone="error" title="Chat is unavailable" body="Please try again later." role="alert" />;
  }

  return <WelcomeState bootstrap={state.bootstrap} bootstrapBaseHref={bootstrapBaseHref} />;
}

function WidgetStateMessage({ tone, title, body, role = 'status', action }: WidgetStateMessageProps) {
  return (
    <section className={`widget-state widget-state--${tone}`}>
      <div key={role} className="widget-state__content" role={role} aria-live={role === 'alert' ? 'assertive' : 'polite'}>
        <span className="widget-state__icon" aria-hidden="true" />
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      {action}
    </section>
  );
}

type WelcomeStateProps = {
  bootstrap: WidgetBootstrapResponse;
  bootstrapBaseHref: string;
};

function WelcomeState({ bootstrap, bootstrapBaseHref }: WelcomeStateProps) {
  const { assistant, theme: themeConfig, welcome } = bootstrap.config;
  const theme = resolveWidgetTheme(themeConfig);

  return (
    <section
      className={`widget-welcome ${theme.className}`}
      aria-label={`${assistant.displayName} chat`}
      data-color-mode={theme.colorMode}
      data-accent={theme.accent}
      data-radius={theme.radius}
    >
      <p className="widget-welcome__assistant">{assistant.displayName}</p>
      <h1>{welcome.title}</h1>
      <p>{welcome.subtitle}</p>
      <WidgetChat publicKey={bootstrap.widget.publicKey} baseHref={bootstrapBaseHref} assistantName={assistant.displayName} />
    </section>
  );
}

type WidgetChatProps = {
  publicKey: string;
  baseHref: string;
  assistantName: string;
};

function WidgetChat({ publicKey, baseHref, assistantName }: WidgetChatProps) {
  const [chatState, setChatState] = useState<WidgetChatState>({ status: 'loading' });
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [draftMessage, setDraftMessage] = useState('');
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const visitorKeyRef = useRef<{ publicKey: string; visitorKey: string } | null>(null);
  const retryPendingRef = useRef(false);
  const followsLatestRef = useRef(true);
  const previousReadyConversationRef = useRef<{ conversationId: string; latestSeq: number } | null>(null);
  const messageCorrectionAnimationFrameRef = useRef<number | null>(null);
  const readyConversationId = chatState.status === 'ready' ? chatState.conversationId : null;
  const renderedMessageCount = chatState.status === 'ready' ? chatState.messageState.messages.length : 0;
  const latestRenderedSeq = chatState.status === 'ready' ? chatState.messageState.latestSeq : 0;

  useEffect(() => {
    let isCurrent = true;
    let subscription: WidgetMessageSubscription | null = null;

    async function initializeChat() {
      try {
        let visitorKey = visitorKeyRef.current;

        if (visitorKey?.publicKey !== publicKey) {
          visitorKey = { publicKey, visitorKey: getOrCreateWidgetVisitorKey(publicKey) };
          visitorKeyRef.current = visitorKey;
        }

        const visitorSessionResponse = await createWidgetVisitorSession(publicKey, visitorKey.visitorKey, { baseHref });

        if (!isCurrent) {
          return;
        }

        const conversationResponse = await createWidgetConversation(publicKey, visitorSessionResponse.visitorSession.id, {
          baseHref,
        });

        if (!isCurrent) {
          return;
        }

        const messageListResponse = await listWidgetMessages(publicKey, {
          visitorSessionId: visitorSessionResponse.visitorSession.id,
          conversationId: conversationResponse.conversation.id,
        }, { baseHref });
        const messageState = createWidgetChatMessagesState(
          conversationResponse.conversation.id,
          messageListResponse.messages,
        );

        if (!isCurrent) {
          return;
        }

        setChatState({
          status: 'ready',
          visitorSessionId: visitorSessionResponse.visitorSession.id,
          conversationId: conversationResponse.conversation.id,
          messageState,
          sendStatus: 'idle',
        });

        subscription = subscribeToWidgetMessages(publicKey, {
          visitorSessionId: visitorSessionResponse.visitorSession.id,
          conversationId: conversationResponse.conversation.id,
          afterSeq: messageState.latestSeq,
        }, {
          baseHref,
          onMessage: (message) => {
            setChatState((currentState) => mergeLiveMessage(currentState, message));
          },
        });
        retryPendingRef.current = false;
      } catch {
        if (isCurrent) {
          retryPendingRef.current = false;
          setChatState({ status: 'error' });
        }
      }
    }

    retryPendingRef.current = true;
    setChatState({ status: 'loading' });
    void initializeChat();

    return () => {
      isCurrent = false;
      subscription?.close();
    };
  }, [baseHref, publicKey, initializationAttempt]);

  useLayoutEffect(() => {
    const previousReadyConversation = previousReadyConversationRef.current;

    if (!readyConversationId) {
      previousReadyConversationRef.current = null;
      return;
    }

    const isNewConversation = previousReadyConversation?.conversationId !== readyConversationId;
    const hasHigherLatestSeq = previousReadyConversation !== null
      && !isNewConversation
      && latestRenderedSeq > previousReadyConversation.latestSeq;

    if (!isNewConversation && !hasHigherLatestSeq) {
      return;
    }

    previousReadyConversationRef.current = {
      conversationId: readyConversationId,
      latestSeq: latestRenderedSeq,
    };

    if (isNewConversation) {
      followsLatestRef.current = true;
      setShowJumpToLatest(false);
    }

    if (renderedMessageCount === 0) {
      return;
    }

    if (!followsLatestRef.current) {
      setShowJumpToLatest(true);
      return;
    }

    const messageScrollElement = messageScrollRef.current;

    if (!messageScrollElement) {
      return;
    }

    messageScrollElement.scrollTop = messageScrollElement.scrollHeight;

    const animationFrameId = requestAnimationFrame(() => {
      if (messageCorrectionAnimationFrameRef.current !== animationFrameId) {
        return;
      }

      messageCorrectionAnimationFrameRef.current = null;

      if (!followsLatestRef.current || messageScrollRef.current !== messageScrollElement) {
        return;
      }

      messageScrollElement.scrollTop = messageScrollElement.scrollHeight;
    });
    messageCorrectionAnimationFrameRef.current = animationFrameId;

    return () => {
      if (messageCorrectionAnimationFrameRef.current === animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        messageCorrectionAnimationFrameRef.current = null;
      }
    };
  }, [readyConversationId, latestRenderedSeq]);

  async function submitDraftMessage() {
    if (chatState.status !== 'ready' || chatState.sendStatus === 'sending') {
      return;
    }

    const body = draftMessage.trim();

    if (!body) {
      return;
    }

    setDraftMessage('');
    setChatState((currentState) => markSendStatus(currentState, 'sending'));

    try {
      const response = await sendWidgetMessage(publicKey, {
        visitorSessionId: chatState.visitorSessionId,
        conversationId: chatState.conversationId,
        clientMessageId: createWidgetClientMessageId(),
        body,
      }, { baseHref });

      setChatState((currentState) => mergeLiveMessage(markSendStatus(currentState, 'idle'), response.message));
    } catch {
      setChatState((currentState) => markSendStatus(currentState, 'error'));
      setDraftMessage(body);
    }
  }

  function handleMessageScroll() {
    const messageScrollElement = messageScrollRef.current;

    if (!messageScrollElement) {
      return;
    }

    const followsLatest = Math.max(
      0,
      messageScrollElement.scrollHeight - messageScrollElement.clientHeight - messageScrollElement.scrollTop,
    ) <= 48;
    followsLatestRef.current = followsLatest;

    if (followsLatest) {
      setShowJumpToLatest(false);
    }
  }

  function handleJumpToLatest() {
    followsLatestRef.current = true;
    setShowJumpToLatest(false);

    const messageScrollElement = messageScrollRef.current;

    if (messageScrollElement) {
      messageScrollElement.scrollTop = messageScrollElement.scrollHeight;
    }
  }

  function handleRetry() {
    if (retryPendingRef.current) {
      return;
    }

    retryPendingRef.current = true;
    setChatState({ status: 'loading' });
    setInitializationAttempt((currentAttempt) => currentAttempt + 1);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitDraftMessage();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const keyAction = resolveWidgetComposerKeyAction(event, draftMessage);

    if (!keyAction.shouldPreventDefault) {
      return;
    }

    event.preventDefault();

    if (keyAction.shouldSubmit) {
      void submitDraftMessage();
    }
  }

  if (chatState.status === 'loading') {
    return <WidgetStateMessage tone="loading" title="Starting chat…" body="Connecting you now." />;
  }

  if (chatState.status === 'error') {
    return (
      <WidgetStateMessage
        tone="error"
        title="Chat couldn’t start"
        body="Try again now, or come back later."
        role="alert"
        action={(
          <button className="widget-state__action" type="button" onClick={handleRetry}>
            Try again
          </button>
        )}
      />
    );
  }

  const isSending = chatState.sendStatus === 'sending';
  const canSend = !isSending && draftMessage.trim().length > 0;
  const composerStatus = isSending
    ? 'Sending your message…'
    : chatState.sendStatus === 'error'
      ? 'Couldn’t send. Try again.'
      : 'Press Enter to send. Shift+Enter for a new line.';
  const composerStatusRole = chatState.sendStatus === 'error' ? 'alert' : 'status';

  return (
    <div className="widget-chat" aria-label={`${assistantName} conversation`}>
      <div className="widget-chat__message-region">
        <div
          className="widget-chat__messages"
          aria-live="polite"
          ref={messageScrollRef}
          onScroll={handleMessageScroll}
        >
          {chatState.messageState.messages.length === 0 ? (
            <WidgetStateMessage tone="empty" title="No messages yet" body="Send a message below to start the conversation." />
          ) : (
            <ol className="widget-chat__message-list">
              {chatState.messageState.messages.map((message) => (
                <li key={message.id} className="widget-chat__message" data-sender={message.sender}>
                  <strong>{message.sender === 'visitor' ? 'You' : assistantName}</strong>
                  <p>{message.body}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
        {showJumpToLatest ? (
          <button className="widget-chat__jump-to-latest" type="button" onClick={handleJumpToLatest}>
            Jump to latest
          </button>
        ) : null}
      </div>
      <form
        className="widget-chat__composer"
        onSubmit={handleSubmit}
        data-send-status={chatState.sendStatus}
        aria-busy={isSending}
      >
        <label className="widget-chat__composer-field" htmlFor="widget-chat-message-input">
          <span>Message</span>
          <textarea
            id="widget-chat-message-input"
            rows={3}
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Type your message…"
            autoComplete="off"
            aria-describedby="widget-chat-composer-status"
            disabled={isSending}
          />
        </label>
        <button type="submit" disabled={!canSend} aria-label={isSending ? 'Sending message' : 'Send message'}>
          {isSending ? 'Sending…' : 'Send'}
        </button>
        <p id="widget-chat-composer-status" className="widget-chat__composer-status" role={composerStatusRole}>
          {composerStatus}
        </p>
      </form>
    </div>
  );
}

function mergeLiveMessage(chatState: WidgetChatState, message: WidgetConversationMessage): WidgetChatState {
  if (chatState.status !== 'ready') {
    return chatState;
  }

  return {
    ...chatState,
    messageState: applyWidgetChatMessage(chatState.messageState, message),
  };
}

function markSendStatus(chatState: WidgetChatState, sendStatus: 'idle' | 'sending' | 'error'): WidgetChatState {
  if (chatState.status !== 'ready') {
    return chatState;
  }

  return {
    ...chatState,
    sendStatus,
  };
}
