/** Lifecycle phase of the widget instance. */
export type PandaChatWidgetLifecycle = 'idle' | 'initializing' | 'ready' | 'error' | 'destroyed';

/** Visibility state of the widget panel. */
export type PandaChatWidgetVisibility = 'closed' | 'open';

/** Auth state. S1 emits only 'anonymous'; the other members are reserved for S9. */
export type PandaChatWidgetAuth = 'anonymous' | 'signing-in' | 'authenticated' | 'expired' | 'error';

/** Frozen public error-code inventory. Reserved protocol/auth codes are declaration-only in S1. */
export type PandaChatWidgetErrorCode =
  | 'MISSING_PUBLIC_KEY'
  | 'INVALID_OPTIONS'
  | 'INVALID_BASE_URL'
  | 'INSTANCE_CONFLICT'
  | 'INIT_OPTIONS_CONFLICT'
  | 'ALREADY_INITIALIZED'
  | 'NOT_INITIALIZED'
  | 'DESTROYED'
  | 'IFRAME_LOAD_FAILED'
  | 'HANDSHAKE_TIMEOUT'
  | 'ORIGIN_MISMATCH'
  | 'PROTOCOL_MISMATCH'
  | 'AUTH_BUSY'
  | 'ALREADY_SIGNED_IN'
  | 'AUTH_REJECTED'
  | 'AUTH_EXPIRED'
  | 'DIRECT_MODE_AUTH_UNAVAILABLE';

/** Safe error snapshot exposed in state. Never contains keys, URLs, tokens, or stacks. */
export interface PandaChatWidgetSafeError {
  readonly scope: 'init' | 'protocol' | 'auth';
  readonly code: PandaChatWidgetErrorCode;
  readonly recoverable: boolean;
  readonly message: string;
}

/** Immutable state snapshot. The error property is absent when no error exists. */
export interface PandaChatWidgetState {
  readonly lifecycle: PandaChatWidgetLifecycle;
  readonly visibility: PandaChatWidgetVisibility;
  readonly auth: PandaChatWidgetAuth;
  readonly error?: PandaChatWidgetSafeError;
}

/** Options for widget initialization. */
export interface PandaChatWidgetOptions {
  readonly publicKey: string;
  readonly baseUrl?: string | undefined;
  readonly launcher?: boolean | undefined;
}

/** Widget control interface. */
export interface PandaChatWidget {
  init(options: PandaChatWidgetOptions): Promise<PandaChatWidgetState>;
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
  getState(): PandaChatWidgetState;
  subscribe(listener: (state: PandaChatWidgetState) => void): () => void;
}
