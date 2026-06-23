export type WidgetChatFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'json' | 'ok' | 'status'>>;

export type WidgetChatOptions = {
  baseHref?: string;
  fetchImpl?: WidgetChatFetch;
};

export type WidgetMessageSender = 'visitor' | 'agent' | 'system';

export type WidgetConversationMessage = {
  id: string;
  conversationId: string;
  seq: number;
  sender: WidgetMessageSender;
  clientMessageId: string | null;
  body: string;
  createdAt: string;
};

export type WidgetVisitorSession = {
  id: string;
  visitorKey: string;
};

export type WidgetConversation = {
  id: string;
  visitorSessionId: string;
  status: 'open';
};

export type WidgetChatMessagesState = {
  conversationId: string;
  messages: WidgetConversationMessage[];
  latestSeq: number;
};

export type WidgetChatEventSource = {
  addEventListener: (event: 'message' | 'ready' | 'error', listener: (event: MessageEvent<string> | Event) => void) => void;
  close: () => void;
};

export type WidgetChatEventSourceConstructor = new (url: string) => WidgetChatEventSource;

export type WidgetMessageSubscription = {
  close: () => void;
};

type VisitorSessionResponse = {
  visitorSession: WidgetVisitorSession;
};

type ConversationResponse = {
  conversation: WidgetConversation;
};

type MessageCreateResponse = {
  message: WidgetConversationMessage;
};

type MessageListResponse = {
  messages: WidgetConversationMessage[];
};

export type MessageReference = {
  visitorSessionId: string;
  conversationId: string;
  afterSeq?: number;
};

export type SendWidgetMessageInput = {
  visitorSessionId: string;
  conversationId: string;
  clientMessageId: string;
  body: string;
};

export type SubscribeWidgetMessagesOptions = {
  baseHref?: string;
  EventSourceImpl?: WidgetChatEventSourceConstructor;
  onMessage: (message: WidgetConversationMessage) => void;
  onReady?: () => void;
  onError?: () => void;
};

function defaultBaseHref(): string {
  return window.location.href;
}

function defaultFetch(): WidgetChatFetch {
  return fetch;
}

function defaultEventSource(): WidgetChatEventSourceConstructor {
  return EventSource;
}

function buildWidgetApiUrl(publicKey: string, path: string, baseHref = defaultBaseHref()): string {
  return new URL(`/api/widgets/${encodeURIComponent(publicKey)}${path}`, baseHref).toString();
}

export function buildWidgetVisitorSessionUrl(publicKey: string, baseHref = defaultBaseHref()): string {
  return buildWidgetApiUrl(publicKey, '/visitor-session', baseHref);
}

export function buildWidgetConversationUrl(publicKey: string, baseHref = defaultBaseHref()): string {
  return buildWidgetApiUrl(publicKey, '/conversations', baseHref);
}

export function buildWidgetMessagesUrl(publicKey: string, input: MessageReference, baseHref = defaultBaseHref()): string {
  return buildWidgetMessagesUrlForPath(publicKey, '/messages', input, baseHref);
}

export function buildWidgetMessageEventsUrl(publicKey: string, input: MessageReference, baseHref = defaultBaseHref()): string {
  return buildWidgetMessagesUrlForPath(publicKey, '/messages/events', input, baseHref);
}

export async function createWidgetVisitorSession(
  publicKey: string,
  visitorKey: string,
  options: WidgetChatOptions = {},
): Promise<VisitorSessionResponse> {
  return postWidgetJson(buildWidgetVisitorSessionUrl(publicKey, options.baseHref), { visitorKey }, options);
}

export async function createWidgetConversation(
  publicKey: string,
  visitorSessionId: string,
  options: WidgetChatOptions = {},
): Promise<ConversationResponse> {
  return postWidgetJson(buildWidgetConversationUrl(publicKey, options.baseHref), { visitorSessionId }, options);
}

export async function listWidgetMessages(
  publicKey: string,
  input: MessageReference,
  options: WidgetChatOptions = {},
): Promise<MessageListResponse> {
  return getWidgetJson(buildWidgetMessagesUrl(publicKey, input, options.baseHref), options);
}

export async function sendWidgetMessage(
  publicKey: string,
  input: SendWidgetMessageInput,
  options: WidgetChatOptions = {},
): Promise<MessageCreateResponse> {
  return postWidgetJson(buildWidgetMessagesUrl(publicKey, input, options.baseHref), input, options);
}

export function subscribeToWidgetMessages(
  publicKey: string,
  input: MessageReference,
  options: SubscribeWidgetMessagesOptions,
): WidgetMessageSubscription {
  const EventSourceImpl = options.EventSourceImpl ?? defaultEventSource();
  const eventSource = new EventSourceImpl(buildWidgetMessageEventsUrl(publicKey, input, options.baseHref));

  eventSource.addEventListener('message', (event) => {
    if (!('data' in event) || typeof event.data !== 'string') {
      return;
    }

    const data = JSON.parse(event.data) as { message?: WidgetConversationMessage };

    if (data.message) {
      options.onMessage(data.message);
    }
  });
  eventSource.addEventListener('ready', () => options.onReady?.());
  eventSource.addEventListener('error', () => options.onError?.());

  return {
    close: () => eventSource.close(),
  };
}

export function createWidgetChatMessagesState(
  conversationId: string,
  messages: WidgetConversationMessage[] = [],
): WidgetChatMessagesState {
  return messages.reduce<WidgetChatMessagesState>(
    (state, message) => applyWidgetChatMessage(state, message),
    { conversationId, messages: [], latestSeq: 0 },
  );
}

export function applyWidgetChatMessage(
  state: WidgetChatMessagesState,
  message: WidgetConversationMessage,
): WidgetChatMessagesState {
  if (message.conversationId !== state.conversationId) {
    return state;
  }

  const messages = [...state.messages.filter((existingMessage) => existingMessage.id !== message.id), message]
    .sort((firstMessage, secondMessage) => firstMessage.seq - secondMessage.seq || firstMessage.id.localeCompare(secondMessage.id));

  return {
    conversationId: state.conversationId,
    messages,
    latestSeq: Math.max(state.latestSeq, message.seq),
  };
}

export function createWidgetClientMessageId(randomBytes = defaultRandomBytes): string {
  const bytes = randomBytes();

  return `cm_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function buildWidgetMessagesUrlForPath(
  publicKey: string,
  path: '/messages' | '/messages/events',
  input: MessageReference,
  baseHref: string,
): string {
  const url = new URL(buildWidgetApiUrl(publicKey, path, baseHref));
  url.searchParams.set('visitorSessionId', input.visitorSessionId);
  url.searchParams.set('conversationId', input.conversationId);

  if (input.afterSeq !== undefined) {
    url.searchParams.set('afterSeq', String(input.afterSeq));
  }

  return url.toString();
}

async function getWidgetJson<T>(url: string, options: WidgetChatOptions): Promise<T> {
  const fetchImpl = options.fetchImpl ?? defaultFetch();
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(`Widget request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

async function postWidgetJson<T>(url: string, payload: unknown, options: WidgetChatOptions): Promise<T> {
  const fetchImpl = options.fetchImpl ?? defaultFetch();
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Widget request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

function defaultRandomBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  return bytes;
}
