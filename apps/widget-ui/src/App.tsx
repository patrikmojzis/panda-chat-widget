import { type FormEvent, useEffect, useState } from 'react';
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

function BootstrapPlaceholder({ state, bootstrapBaseHref }: BootstrapPlaceholderProps) {
  if (state.status === 'missing_key') {
    return <p>Missing widget key. Add a non-empty publicKey query parameter to configure this placeholder.</p>;
  }

  if (state.status === 'loading') {
    return <p>Loading widget configuration…</p>;
  }

  if (state.status === 'error') {
    return <p>Widget configuration could not be loaded. The widget is unavailable for this site.</p>;
  }

  return <WelcomeState bootstrap={state.bootstrap} bootstrapBaseHref={bootstrapBaseHref} />;
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
  const [draftMessage, setDraftMessage] = useState('');

  useEffect(() => {
    let isCurrent = true;
    let subscription: WidgetMessageSubscription | null = null;

    async function initializeChat() {
      try {
        const visitorKey = getOrCreateWidgetVisitorKey(publicKey);
        const visitorSessionResponse = await createWidgetVisitorSession(publicKey, visitorKey, { baseHref });
        const conversationResponse = await createWidgetConversation(publicKey, visitorSessionResponse.visitorSession.id, {
          baseHref,
        });
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
      } catch {
        if (isCurrent) {
          setChatState({ status: 'error' });
        }
      }
    }

    setChatState({ status: 'loading' });
    void initializeChat();

    return () => {
      isCurrent = false;
      subscription?.close();
    };
  }, [baseHref, publicKey]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (chatState.status !== 'ready') {
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

  if (chatState.status === 'loading') {
    return <p className="widget-welcome__empty">Starting chat…</p>;
  }

  if (chatState.status === 'error') {
    return <p className="widget-welcome__empty">Chat could not be started. Please try again later.</p>;
  }

  return (
    <div className="widget-chat" aria-label={`${assistantName} conversation`}>
      {chatState.messageState.messages.length === 0 ? (
        <p className="widget-welcome__empty">Send a message to start the conversation.</p>
      ) : (
        <ol className="widget-chat__messages">
          {chatState.messageState.messages.map((message) => (
            <li key={message.id} className="widget-chat__message" data-sender={message.sender}>
              <strong>{message.sender === 'visitor' ? 'You' : assistantName}</strong>
              <p>{message.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form className="widget-chat__composer" onSubmit={handleSubmit}>
        <label>
          <span>Message</span>
          <input
            type="text"
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
            disabled={chatState.sendStatus === 'sending'}
          />
        </label>
        <button type="submit" disabled={chatState.sendStatus === 'sending' || !draftMessage.trim()}>
          {chatState.sendStatus === 'sending' ? 'Sending…' : 'Send'}
        </button>
        {chatState.sendStatus === 'error' ? (
          <p className="widget-welcome__empty">Message could not be sent. Try again.</p>
        ) : null}
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
