export type WidgetPublicKeyState =
  | {
      status: 'configured';
      publicKey: string;
    }
  | {
      status: 'missing_key';
    };

export function readWidgetPublicKey(search: string): WidgetPublicKeyState {
  const publicKey = new URLSearchParams(search).get('publicKey')?.trim();

  if (!publicKey) {
    return { status: 'missing_key' };
  }

  return { status: 'configured', publicKey };
}
