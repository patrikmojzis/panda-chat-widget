/**
 * Side-effect-free ESM entry.
 * Does not write globals, auto-init, acquire leases, or create DOM on import.
 */

export type {
  PandaChatWidgetLifecycle,
  PandaChatWidgetVisibility,
  PandaChatWidgetAuth,
  PandaChatWidgetErrorCode,
  PandaChatWidgetSafeError,
  PandaChatWidgetState,
  PandaChatWidgetOptions,
  PandaChatWidget,
} from './types.js';

export { PandaChatWidgetError } from './errors.js';

import type { PandaChatWidget } from './types.js';
import { createWidgetInstance } from './core.js';
import { createIframeDriver } from './iframe-driver.js';

/**
 * Create a new widget instance with temporary iframe-load readiness.
 * Each call returns a fresh instance; only one may mount per document.
 */
export function createPandaChatWidget(): PandaChatWidget {
  return createWidgetInstance(
    () => createIframeDriver(),
    () => typeof document !== 'undefined' ? document : null,
  );
}
