import {
  createPandaChatWidget,
  PandaChatWidgetError,
  type PandaChatWidget,
  type PandaChatWidgetAuth,
  type PandaChatWidgetErrorCode,
  type PandaChatWidgetLifecycle,
  type PandaChatWidgetSafeError,
  type PandaChatWidgetState,
  type PandaChatWidgetVisibility,
} from '@panda-chat-widget/loader';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false
  : false;
type Assert<T extends true> = T;

type LifecycleIsExact = Assert<Equal<PandaChatWidgetLifecycle, 'idle' | 'initializing' | 'ready' | 'error' | 'destroyed'>>;
type VisibilityIsExact = Assert<Equal<PandaChatWidgetVisibility, 'closed' | 'open'>>;
type AuthIsExact = Assert<Equal<PandaChatWidgetAuth, 'anonymous' | 'signing-in' | 'authenticated' | 'expired' | 'error'>>;
type ErrorCodesAreExact = Assert<Equal<PandaChatWidgetErrorCode,
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
  | 'DIRECT_MODE_AUTH_UNAVAILABLE'
>>;
type StateIsExact = Assert<Equal<PandaChatWidgetState, Readonly<{
  lifecycle: PandaChatWidgetLifecycle;
  visibility: PandaChatWidgetVisibility;
  auth: PandaChatWidgetAuth;
  error?: PandaChatWidgetSafeError;
}>>>;

const widget: PandaChatWidget = createPandaChatWidget();
const initResult: Promise<PandaChatWidgetState> = widget.init({ publicKey: 'public-key' });
const stateWithoutError: PandaChatWidgetState = {
  lifecycle: 'idle',
  visibility: 'closed',
  auth: 'anonymous',
};
const safe: PandaChatWidgetSafeError = {
  scope: 'init',
  code: 'MISSING_PUBLIC_KEY',
  recoverable: true,
  message: 'safe',
};
const json: PandaChatWidgetSafeError = new PandaChatWidgetError(safe).toJSON();
void initResult;
void stateWithoutError;
void json;

// @ts-expect-error old runtime scope is forbidden
const runtimeScope: PandaChatWidgetSafeError['scope'] = 'runtime';
// @ts-expect-error absent state errors are omitted, never null
const nullError: PandaChatWidgetState = { lifecycle: 'idle', visibility: 'closed', auth: 'anonymous', error: null };
// @ts-expect-error old auth member is forbidden
const unauthenticated: PandaChatWidgetAuth = 'unauthenticated';
// @ts-expect-error old bridge error code is forbidden
const bridgeError: PandaChatWidgetErrorCode = 'BRIDGE_ERROR';
// @ts-expect-error auth methods are not present in S1
widget.signIn();
// @ts-expect-error auth methods are not present in S1
widget.signOut();
void runtimeScope;
void nullError;
void unauthenticated;
void bridgeError;
