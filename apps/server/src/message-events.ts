import type { ConversationMessage } from './message.ts';

export type ConversationMessageEvent = {
  event: 'message';
  message: ConversationMessage;
};

export type ConversationMessageEventListener = (event: ConversationMessageEvent) => void;

export type ConversationMessageEventSubscription = {
  close: () => void;
};

export type ConversationMessageEventEmitter = {
  subscribe: (
    conversationId: string,
    listener: ConversationMessageEventListener,
  ) => ConversationMessageEventSubscription;
  emit: (message: ConversationMessage) => void;
};

export function createConversationMessageEventEmitter(): ConversationMessageEventEmitter {
  const listenersByConversationId = new Map<string, Set<ConversationMessageEventListener>>();

  return {
    subscribe: (conversationId, listener) => {
      const listeners = listenersByConversationId.get(conversationId) ?? new Set<ConversationMessageEventListener>();
      listeners.add(listener);
      listenersByConversationId.set(conversationId, listeners);

      let closed = false;

      return {
        close: () => {
          if (closed) {
            return;
          }

          closed = true;
          listeners.delete(listener);

          if (listeners.size === 0) {
            listenersByConversationId.delete(conversationId);
          }
        },
      };
    },
    emit: (message) => {
      const listeners = listenersByConversationId.get(message.conversationId);

      if (!listeners) {
        return;
      }

      const event: ConversationMessageEvent = { event: 'message', message };

      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}
