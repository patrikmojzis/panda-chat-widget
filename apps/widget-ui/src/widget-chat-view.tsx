import type {
  ChangeEventHandler,
  FormEventHandler,
  KeyboardEventHandler,
  ReactNode,
  RefObject,
} from 'react';
import type { WidgetConversationMessage } from './widget-chat';

type WidgetStateMessageProps = {
  tone: 'loading' | 'empty' | 'error';
  title: string;
  body: string;
  role?: 'status' | 'alert';
  action?: ReactNode;
};

export function WidgetStateMessage({ tone, title, body, role = 'status', action }: WidgetStateMessageProps) {
  return (
    <section className={`widget-state widget-state--${tone}`}>
      <div key={role} className="widget-state__content" role={role} aria-live={role === 'alert' ? 'assertive' : 'polite'}>
        <span className="widget-state__icon" aria-hidden="true">
          <SparklesIcon />
        </span>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      {action}
    </section>
  );
}

export function WidgetHeader({ assistantName }: { assistantName: string }) {
  return (
    <header className="widget-header">
      <span className="widget-header__avatar" aria-hidden="true">
        <SparklesIcon />
      </span>
      <div className="widget-header__copy">
        <strong>{assistantName}</strong>
        <span><i aria-hidden="true" /> Ready to help</span>
      </div>
    </header>
  );
}

export function WidgetEmptyConversation({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="widget-chat__empty">
      <span className="widget-chat__empty-icon" aria-hidden="true">
        <SparklesIcon />
      </span>
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

export function WidgetMessageList({
  assistantName,
  messages,
}: {
  assistantName: string;
  messages: WidgetConversationMessage[];
}) {
  return (
    <ol className="widget-chat__message-list">
      {messages.map((message) => (
        <li key={message.id} className="widget-chat__message" data-sender={message.sender}>
          <span className="sr-only">{message.sender === 'visitor' ? 'You' : assistantName}: </span>
          <p>{message.body}</p>
        </li>
      ))}
    </ol>
  );
}

type WidgetComposerProps = {
  canSend: boolean;
  draftMessage: string;
  isSending: boolean;
  sendStatus: 'idle' | 'sending' | 'error';
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

export function WidgetComposer({
  canSend,
  draftMessage,
  isSending,
  onChange,
  onKeyDown,
  onSubmit,
  sendStatus,
  textareaRef,
}: WidgetComposerProps) {
  const visibleStatus = sendStatus === 'sending'
    ? 'Sending…'
    : sendStatus === 'error'
      ? 'Couldn’t send. Try again.'
      : '';

  return (
    <form className="widget-chat__composer" onSubmit={onSubmit} data-send-status={sendStatus} aria-busy={isSending}>
      <div className="widget-chat__composer-control">
        <label className="sr-only" htmlFor="widget-chat-message-input">Message</label>
        <textarea
          ref={textareaRef}
          id="widget-chat-message-input"
          rows={1}
          value={draftMessage}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder="Ask, search, or chat…"
          autoComplete="off"
          enterKeyHint="send"
          aria-describedby="widget-chat-composer-hint widget-chat-composer-status"
          disabled={isSending}
        />
        <div className="widget-chat__composer-footer">
          <p id="widget-chat-composer-status" className="widget-chat__composer-status" role={sendStatus === 'error' ? 'alert' : 'status'}>
            {visibleStatus}
          </p>
          <button type="submit" disabled={!canSend} aria-label={isSending ? 'Sending message' : 'Send message'}>
            {isSending ? <SpinnerIcon /> : <ArrowUpIcon />}
          </button>
        </div>
      </div>
      <span id="widget-chat-composer-hint" className="sr-only">Press Enter to send. Shift+Enter for a new line.</span>
    </form>
  );
}

function SparklesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3-1.2 3.3a5 5 0 0 1-3 3L4.5 10.5l3.3 1.2a5 5 0 0 1 3 3L12 18l1.2-3.3a5 5 0 0 1 3-3l3.3-1.2-3.3-1.2a5 5 0 0 1-3-3L12 3Z" />
      <path d="m5 3-.4 1.1a2 2 0 0 1-1.2 1.2L2.3 5.7l1.1.4a2 2 0 0 1 1.2 1.2L5 8.4l.4-1.1a2 2 0 0 1 1.2-1.2l1.1-.4-1.1-.4a2 2 0 0 1-1.2-1.2L5 3Z" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="widget-chat__spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </svg>
  );
}
