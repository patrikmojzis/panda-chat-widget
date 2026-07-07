import { randomBytes, timingSafeEqual, scrypt as scryptCallback, type ScryptOptions } from 'node:crypto';

const PASSWORD_HASH_PREFIX = 'scrypt';
const PASSWORD_HASH_VERSION = 'v1';
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 32;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PASSWORD_SALT_BYTES).toString('base64url');
  const hash = await derivePasswordHash(password, salt);

  return [
    PASSWORD_HASH_PREFIX,
    PASSWORD_HASH_VERSION,
    `n=${SCRYPT_COST},r=${SCRYPT_BLOCK_SIZE},p=${SCRYPT_PARALLELIZATION},key=${PASSWORD_KEY_BYTES}`,
    salt,
    hash.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parsedHash = parsePasswordHash(storedHash);

  if (!parsedHash) {
    return false;
  }

  const candidateHash = await derivePasswordHash(password, parsedHash.salt);

  if (candidateHash.length !== parsedHash.hash.length) {
    return false;
  }

  return timingSafeEqual(candidateHash, parsedHash.hash);
}

type ParsedPasswordHash = {
  salt: string;
  hash: Buffer;
};

function parsePasswordHash(storedHash: string): ParsedPasswordHash | null {
  const parts = storedHash.split('$');

  if (parts.length !== 5) {
    return null;
  }

  const [prefix, version, parameters, salt, encodedHash] = parts;

  if (prefix !== PASSWORD_HASH_PREFIX || version !== PASSWORD_HASH_VERSION) {
    return null;
  }

  if (parameters !== `n=${SCRYPT_COST},r=${SCRYPT_BLOCK_SIZE},p=${SCRYPT_PARALLELIZATION},key=${PASSWORD_KEY_BYTES}`) {
    return null;
  }

  if (!salt || !encodedHash || !/^[A-Za-z0-9_-]+$/.test(salt) || !/^[A-Za-z0-9_-]+$/.test(encodedHash)) {
    return null;
  }

  try {
    const hash = Buffer.from(encodedHash, 'base64url');

    if (hash.length !== PASSWORD_KEY_BYTES) {
      return null;
    }

    return { salt, hash };
  } catch {
    return null;
  }
}

async function derivePasswordHash(password: string, salt: string): Promise<Buffer> {
  return scryptAsync(password, salt, PASSWORD_KEY_BYTES, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
}

function scryptAsync(password: string, salt: string, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(Buffer.from(derivedKey));
    });
  });
}
