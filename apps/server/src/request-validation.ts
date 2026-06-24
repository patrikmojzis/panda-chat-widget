export type InvalidWidgetRequestReason = 'missing_public_key' | 'invalid_public_key';

export type InvalidWidgetRequestErrorResponse = {
  error: 'invalid_widget_request';
  reason: InvalidWidgetRequestReason;
};

export type PublicWidgetKeyReadResult =
  | {
      status: 'valid';
      publicKey: string;
    }
  | {
      status: 'invalid';
      reason: InvalidWidgetRequestReason;
    };

type PublicWidgetRouteParams = {
  publicKey?: unknown;
};

export function readPublicWidgetKey(params: unknown): PublicWidgetKeyReadResult {
  if (typeof params !== 'object' || params === null || !('publicKey' in params)) {
    return { status: 'invalid', reason: 'missing_public_key' };
  }

  const value = (params as PublicWidgetRouteParams).publicKey;

  if (typeof value !== 'string') {
    return { status: 'invalid', reason: 'invalid_public_key' };
  }

  const publicKey = value.trim();

  if (!publicKey) {
    return { status: 'invalid', reason: 'missing_public_key' };
  }

  return { status: 'valid', publicKey };
}
