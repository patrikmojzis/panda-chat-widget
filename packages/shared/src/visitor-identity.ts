export type VisitorKey = string;
export type VisitorSessionId = string;

export type VisitorKeyValidationResult =
  | {
      status: 'valid';
      visitorKey: VisitorKey;
    }
  | {
      status: 'invalid';
      reason: 'not_string' | 'empty' | 'invalid_format';
    };

export type VisitorSessionCreateRequest = {
  visitorKey: VisitorKey;
};

export type VisitorSessionCreateResponse = {
  visitorSession: {
    id: VisitorSessionId;
    visitorKey: VisitorKey;
  };
};

export type VisitorSessionReference = {
  visitorSessionId: VisitorSessionId;
};

export const VISITOR_KEY_STORAGE_PREFIX = 'panda-chat-widget:visitor-key:v1:';
export const VISITOR_KEY_PREFIX = 'pvk_';
export const VISITOR_KEY_RANDOM_BYTES = 32;
export const VISITOR_KEY_RANDOM_PART_LENGTH = 43;
export const VISITOR_KEY_PATTERN = /^pvk_[A-Za-z0-9_-]{43}$/;

export const VISITOR_IDENTITY_CONTRACT = {
  persistenceOwner: 'iframe_local_storage',
  storageKeyPrefix: VISITOR_KEY_STORAGE_PREFIX,
  serverSession: {
    method: 'POST',
    path: '/api/widgets/:publicKey/visitor-session',
    requestBody: 'VisitorSessionCreateRequest',
    responseBody: 'VisitorSessionCreateResponse',
  },
  conversation: {
    requestReference: 'VisitorSessionReference',
  },
} as const;

/**
 * V1 anonymous visitor identity contract:
 * - The iframe owns generation and persistence, later using Web Crypto random bytes.
 * - The visitor key is opaque and random; it is not derived from browser, network, or host-page traits.
 * - The iframe stores one key per widget public key in localStorage using buildVisitorKeyStorageKey().
 * - G2 creates or reuses the server visitor session from VisitorSessionCreateRequest.
 * - G3 conversation creation should reference the G2 visitorSession.id via VisitorSessionReference.
 */
export function buildVisitorKeyStorageKey(publicKey: string): string {
  return `${VISITOR_KEY_STORAGE_PREFIX}${encodeURIComponent(publicKey)}`;
}

export function parseVisitorKey(value: unknown): VisitorKeyValidationResult {
  if (typeof value !== 'string') {
    return { status: 'invalid', reason: 'not_string' };
  }

  const visitorKey = value.trim();

  if (visitorKey.length === 0) {
    return { status: 'invalid', reason: 'empty' };
  }

  if (!VISITOR_KEY_PATTERN.test(visitorKey)) {
    return { status: 'invalid', reason: 'invalid_format' };
  }

  return { status: 'valid', visitorKey };
}
