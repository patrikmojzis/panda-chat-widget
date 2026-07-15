import type { PandaChatWidgetErrorCode, PandaChatWidgetSafeError } from './types.js';

type S1ErrorCode = Extract<
  PandaChatWidgetErrorCode,
  | 'MISSING_PUBLIC_KEY'
  | 'INVALID_OPTIONS'
  | 'INVALID_BASE_URL'
  | 'INSTANCE_CONFLICT'
  | 'INIT_OPTIONS_CONFLICT'
  | 'ALREADY_INITIALIZED'
  | 'NOT_INITIALIZED'
  | 'DESTROYED'
  | 'IFRAME_LOAD_FAILED'
>;

const ERROR_MESSAGES: Record<S1ErrorCode, string> = {
  MISSING_PUBLIC_KEY: 'A non-empty publicKey is required.',
  INVALID_OPTIONS: 'Invalid widget options.',
  INVALID_BASE_URL: 'baseUrl must resolve to an absolute http: or https: URL.',
  INSTANCE_CONFLICT: 'Another widget instance is already mounted in this document.',
  INIT_OPTIONS_CONFLICT: 'Widget is already initializing or initialized with different options.',
  ALREADY_INITIALIZED: 'Widget is already initialized with different options.',
  NOT_INITIALIZED: 'Widget is not initialized.',
  DESTROYED: 'Widget has been destroyed.',
  IFRAME_LOAD_FAILED: 'Widget iframe failed to load.',
};

export function createSafeError(scope: 'init', code: S1ErrorCode, recoverable: boolean): PandaChatWidgetSafeError {
  return Object.freeze({ scope, code, recoverable, message: ERROR_MESSAGES[code] });
}

export class PandaChatWidgetError extends Error {
  readonly scope: PandaChatWidgetSafeError['scope'];
  readonly code: PandaChatWidgetErrorCode;
  readonly recoverable: boolean;
  private readonly safeSnapshot: PandaChatWidgetSafeError;

  constructor(safeError: PandaChatWidgetSafeError) {
    super(safeError.message);
    this.name = 'PandaChatWidgetError';
    this.scope = safeError.scope;
    this.code = safeError.code;
    this.recoverable = safeError.recoverable;
    this.safeSnapshot = Object.freeze({
      scope: safeError.scope,
      code: safeError.code,
      recoverable: safeError.recoverable,
      message: safeError.message,
    });
  }

  toJSON(): PandaChatWidgetSafeError {
    return { ...this.safeSnapshot };
  }
}
