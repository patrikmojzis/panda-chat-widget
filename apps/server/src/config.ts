import type { ListenOptions } from './listen.ts';

export type DatabaseConfig = {
  url: string;
};

export type AuthConfig = {
  secureCookies: boolean;
};

export type ServerConfig = {
  listen: ListenOptions;
  logger: boolean;
  auth: AuthConfig;
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_LOGGER = true;
export const DEFAULT_DATABASE_URL = 'postgresql://panda_chat_widget:panda_chat_widget@127.0.0.1:5432/panda_chat_widget';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    listen: {
      host: parseHost(env.HOST),
      port: parsePort(env.PORT),
    },
    logger: parseServerLogger(env.SERVER_LOGGER),
    auth: {
      secureCookies: parseAuthCookieSecure(env.AUTH_COOKIE_SECURE, env.NODE_ENV),
    },
  };
}

export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  return {
    url: parseDatabaseUrl(env.DATABASE_URL),
  };
}

function parseHost(value: string | undefined): string {
  if (value === undefined) {
    return DEFAULT_HOST;
  }

  const host = value.trim();

  if (host.length === 0) {
    throw new Error('Invalid HOST: expected a non-empty host');
  }

  return host;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const rawPort = value.trim();

  if (!/^\d+$/.test(rawPort)) {
    throw new Error('Invalid PORT: expected an integer from 1 to 65535');
  }

  const port = Number(rawPort);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid PORT: expected an integer from 1 to 65535');
  }

  return port;
}

function parseServerLogger(value: string | undefined): boolean {
  if (value === undefined) {
    return DEFAULT_LOGGER;
  }

  switch (value.trim().toLowerCase()) {
    case 'true':
    case '1':
      return true;
    case 'false':
    case '0':
      return false;
    default:
      throw new Error('Invalid SERVER_LOGGER: expected true, false, 1, or 0');
  }
}

function parseDatabaseUrl(value: string | undefined): string {
  if (value === undefined) {
    return DEFAULT_DATABASE_URL;
  }

  const databaseUrl = value.trim();

  if (databaseUrl.length === 0) {
    throw new Error('Invalid DATABASE_URL: expected a postgres:// or postgresql:// URL');
  }

  try {
    const parsed = new URL(databaseUrl);

    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error('invalid protocol');
    }
  } catch {
    throw new Error('Invalid DATABASE_URL: expected a postgres:// or postgresql:// URL');
  }

  return databaseUrl;
}

function parseAuthCookieSecure(value: string | undefined, nodeEnv: string | undefined): boolean {
  if (value === undefined) {
    return nodeEnv?.trim().toLowerCase() === 'production';
  }

  switch (value.trim().toLowerCase()) {
    case 'true':
    case '1':
      return true;
    case 'false':
    case '0':
      return false;
    default:
      throw new Error('Invalid AUTH_COOKIE_SECURE: expected true, false, 1, or 0');
  }
}
