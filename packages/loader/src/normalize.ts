import type { PandaChatWidgetOptions } from './types.js';

export interface NormalizedOptions {
  readonly publicKey: string;
  readonly baseUrl: string;
  readonly launcher: boolean;
}

/**
 * Normalize and validate widget options.
 * Returns null with an error code string if invalid.
 */
export function normalizeOptions(
  options: PandaChatWidgetOptions,
  documentOrigin: string,
): { normalized: NormalizedOptions; error: null } | { normalized: null; error: 'MISSING_PUBLIC_KEY' | 'INVALID_OPTIONS' | 'INVALID_BASE_URL' } {
  if (!options || typeof options !== 'object') {
    return { normalized: null, error: 'INVALID_OPTIONS' };
  }

  const publicKey = typeof options.publicKey === 'string' ? options.publicKey.trim() : '';

  if (!publicKey) {
    return { normalized: null, error: 'MISSING_PUBLIC_KEY' };
  }

  if (options.launcher !== undefined && options.launcher !== true && options.launcher !== false) {
    return { normalized: null, error: 'INVALID_OPTIONS' };
  }

  const launcher = options.launcher !== false;
  let baseUrl: string;

  if (options.baseUrl !== undefined) {
    if (typeof options.baseUrl !== 'string') {
      return { normalized: null, error: 'INVALID_BASE_URL' };
    }

    try {
      const resolved = new URL(options.baseUrl, documentOrigin);

      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
        return { normalized: null, error: 'INVALID_BASE_URL' };
      }

      baseUrl = resolved.toString().replace(/\/$/, '');
    } catch {
      return { normalized: null, error: 'INVALID_BASE_URL' };
    }
  } else {
    baseUrl = documentOrigin.replace(/\/$/, '');
  }

  return {
    normalized: Object.freeze({ publicKey, baseUrl, launcher }),
    error: null,
  };
}

export function optionsEqual(a: NormalizedOptions, b: NormalizedOptions): boolean {
  return a.publicKey === b.publicKey && a.baseUrl === b.baseUrl && a.launcher === b.launcher;
}
