import { type FormEvent, type KeyboardEvent, StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { WidgetConversationMessage } from './widget-chat';
import { WidgetComposer, WidgetEmptyConversation, WidgetHeader, WidgetMessageList } from './widget-chat-view';
import { resolveWidgetComposerKeyAction } from './widget-composer';
import './styles.css';

const previewMessages: WidgetConversationMessage[] = [
  {
    id: 'preview-1',
    conversationId: 'preview',
    seq: 1,
    sender: 'visitor',
    clientMessageId: 'preview-client-1',
    body: 'Can you help me choose the right product for a small clinic?',
    createdAt: '2026-07-23T12:00:00.000Z',
  },
  {
    id: 'preview-2',
    conversationId: 'preview',
    seq: 2,
    sender: 'agent',
    clientMessageId: null,
    body: 'Of course. Tell me how many people will use it and which procedures you handle most often.',
    createdAt: '2026-07-23T12:00:01.000Z',
  },
];

function WidgetPreview() {
  const previewParams = new URLSearchParams(window.location.search);
  const startsEmpty = previewParams.has('empty');
  const colorMode = previewParams.has('dark') ? 'dark' : 'light';
  const [messages, setMessages] = useState<WidgetConversationMessage[]>(startsEmpty ? [] : previewMessages);
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submitPreview(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body) return;

    setMessages((current) => [
      ...current,
      {
        id: `preview-${current.length + 1}`,
        conversationId: 'preview',
        seq: current.length + 1,
        sender: 'visitor',
        clientMessageId: `preview-client-${current.length + 1}`,
        body,
        createdAt: new Date().toISOString(),
      },
    ]);
    setDraft('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const action = resolveWidgetComposerKeyAction(event, draft);
    if (!action.shouldPreventDefault) return;
    event.preventDefault();
    if (action.shouldSubmit) submitPreview();
  }

  return (
    <main className="widget-shell" aria-label="Panda chat widget visual preview">
      <section
        className={`widget-panel widget-panel--mode-${colorMode} widget-panel--accent-blue widget-panel--radius-md`}
        data-color-mode={colorMode}
        data-accent="blue"
        data-radius="md"
      >
        <WidgetHeader assistantName="Panda Assistant" />
        <div className="widget-chat" aria-label="Panda Assistant conversation">
          <div className="widget-chat__message-region">
            <div className="widget-chat__messages" aria-live="polite">
              {messages.length === 0 ? (
                <WidgetEmptyConversation
                  title="How can I help?"
                  subtitle="Ask me anything or describe what you need help with."
                />
              ) : (
                <WidgetMessageList assistantName="Panda Assistant" messages={messages} />
              )}
            </div>
          </div>
          <WidgetComposer
            canSend={draft.trim().length > 0}
            draftMessage={draft}
            isSending={false}
            sendStatus="idle"
            textareaRef={textareaRef}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            onSubmit={submitPreview}
          />
        </div>
      </section>
    </main>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Widget preview root not found');

createRoot(rootElement).render(
  <StrictMode>
    <WidgetPreview />
  </StrictMode>,
);
