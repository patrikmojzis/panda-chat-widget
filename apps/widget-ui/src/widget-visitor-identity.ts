import {
  buildVisitorKeyStorageKey,
  parseVisitorKey,
  VISITOR_KEY_PREFIX,
  VISITOR_KEY_RANDOM_BYTES,
} from '@panda-chat-widget/shared';

export type WidgetVisitorKeyStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type WidgetVisitorKeyCrypto = Pick<Crypto, 'getRandomValues'>;

export type WidgetVisitorKeyOptions = {
  storage?: WidgetVisitorKeyStorage | null;
  cryptoImpl?: WidgetVisitorKeyCrypto;
};

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function defaultStorage(): WidgetVisitorKeyStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function defaultCrypto(): WidgetVisitorKeyCrypto {
  return crypto;
}

export function createWidgetVisitorKey(cryptoImpl: WidgetVisitorKeyCrypto = defaultCrypto()): string {
  const randomBytes = new Uint8Array(VISITOR_KEY_RANDOM_BYTES);
  cryptoImpl.getRandomValues(randomBytes);

  return `${VISITOR_KEY_PREFIX}${toBase64Url(randomBytes)}`;
}

export function getOrCreateWidgetVisitorKey(
  publicKey: string,
  options: WidgetVisitorKeyOptions = {},
): string {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const storageKey = buildVisitorKeyStorageKey(publicKey);
  const storedVisitorKey = readStoredVisitorKey(storage, storageKey);
  const parsedStoredVisitorKey = parseVisitorKey(storedVisitorKey);

  if (parsedStoredVisitorKey.status === 'valid') {
    return parsedStoredVisitorKey.visitorKey;
  }

  const visitorKey = createWidgetVisitorKey(options.cryptoImpl ?? defaultCrypto());
  writeStoredVisitorKey(storage, storageKey, visitorKey);

  return visitorKey;
}

function readStoredVisitorKey(storage: WidgetVisitorKeyStorage | null, storageKey: string): string | null {
  try {
    return storage?.getItem(storageKey) ?? null;
  } catch {
    return null;
  }
}

function writeStoredVisitorKey(
  storage: WidgetVisitorKeyStorage | null,
  storageKey: string,
  visitorKey: string,
): void {
  try {
    storage?.setItem(storageKey, visitorKey);
  } catch {
    // A blocked storage write should not prevent a one-page visitor session.
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const firstByte = bytes[index] ?? 0;
    const secondByte = bytes[index + 1] ?? 0;
    const thirdByte = bytes[index + 2] ?? 0;
    const bits = (firstByte << 16) | (secondByte << 8) | thirdByte;

    output += BASE64URL_ALPHABET[(bits >> 18) & 63];
    output += BASE64URL_ALPHABET[(bits >> 12) & 63];

    if (index + 1 < bytes.length) {
      output += BASE64URL_ALPHABET[(bits >> 6) & 63];
    }

    if (index + 2 < bytes.length) {
      output += BASE64URL_ALPHABET[bits & 63];
    }
  }

  return output;
}
