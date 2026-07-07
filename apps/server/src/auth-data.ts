import { sql, type Insertable, type Transaction } from 'kysely';

import { hashPassword as defaultHashPassword, verifyPassword as defaultVerifyPassword } from './auth-password.ts';
import {
  createSessionToken as defaultCreateSessionToken,
  hashSessionToken,
  SESSION_MAX_AGE_SECONDS,
} from './auth-session.ts';
import type { AuthContext, LoginRequest, SetupRequest } from './auth-validation.ts';
import type { DatabaseClient, DatabaseSchema } from './db.ts';

type AuthDatabase = DatabaseClient | Transaction<DatabaseSchema>;

type SetupUserRow = {
  id: string;
  email: string;
};

type SetupWorkspaceRow = {
  id: string;
  name: string;
};

type LoginRow = {
  userId: string;
  email: string;
  passwordHash: string;
  workspaceId: string;
  workspaceName: string;
};

type SessionContextRow = {
  sessionId: string;
  userId: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
};

export type AuthSessionResult = AuthContext & {
  sessionToken: string;
};

export type CreateFirstOwnerSetupResult =
  | ({
      status: 'created';
    } & AuthSessionResult)
  | {
      status: 'setup_already_completed';
    };

export type LoginResult =
  | ({
      status: 'authenticated';
    } & AuthSessionResult)
  | {
      status: 'invalid_credentials';
    };

export type AuthDataDependencies = {
  acquireSetupLock?: (database: AuthDatabase) => Promise<void>;
  createSessionToken?: () => string;
  hashPassword?: (password: string) => Promise<string>;
  now?: () => Date;
  verifyPassword?: (password: string, storedHash: string) => Promise<boolean>;
};

export async function hasAnyUsers(database: DatabaseClient): Promise<boolean> {
  const row = await database.selectFrom('users').select('id').limit(1).executeTakeFirst();

  return row !== undefined;
}

export async function createFirstOwnerSetup(
  database: DatabaseClient,
  input: SetupRequest,
  dependencies: AuthDataDependencies = {},
): Promise<CreateFirstOwnerSetupResult> {
  const hashPassword = dependencies.hashPassword ?? defaultHashPassword;
  const createSessionToken = dependencies.createSessionToken ?? defaultCreateSessionToken;
  const acquireSetupLock = dependencies.acquireSetupLock ?? acquireFirstOwnerSetupLock;
  const now = dependencies.now ?? (() => new Date());
  const passwordHash = await hashPassword(input.password);
  const sessionToken = createSessionToken();
  const tokenHash = hashSessionToken(sessionToken);

  return database.transaction().execute(async (transaction) => {
    await acquireSetupLock(transaction);

    if (await hasAnyUsersInTransaction(transaction)) {
      return { status: 'setup_already_completed' };
    }

    const createdAt = now();
    const user = await insertOwnerUser(transaction, {
      email: input.email,
      passwordHash,
      now: createdAt,
    });
    const workspace = await insertOwnerWorkspace(transaction, {
      ownerUserId: user.id,
      name: input.workspaceName,
      now: createdAt,
    });

    await insertAuthSession(transaction, {
      userId: user.id,
      tokenHash,
      now: createdAt,
    });

    return {
      status: 'created',
      sessionToken,
      user: {
        id: user.id,
        email: user.email,
      },
      workspace: {
        id: workspace.id,
        name: workspace.name,
      },
    };
  });
}

export async function loginOwner(
  database: DatabaseClient,
  input: LoginRequest,
  dependencies: AuthDataDependencies = {},
): Promise<LoginResult> {
  const createSessionToken = dependencies.createSessionToken ?? defaultCreateSessionToken;
  const hashPassword = dependencies.hashPassword ?? defaultHashPassword;
  const now = dependencies.now ?? (() => new Date());
  const verifyPassword = dependencies.verifyPassword ?? defaultVerifyPassword;
  const loginContext = await findOwnerLoginContext(database, input.email);

  if (!loginContext) {
    await hashPassword(input.password);
    return { status: 'invalid_credentials' };
  }

  const passwordMatches = await verifyPassword(input.password, loginContext.passwordHash);

  if (!passwordMatches) {
    return { status: 'invalid_credentials' };
  }

  const sessionToken = createSessionToken();
  const tokenHash = hashSessionToken(sessionToken);

  await insertAuthSession(database, {
    userId: loginContext.user.id,
    tokenHash,
    now: now(),
  });

  return {
    status: 'authenticated',
    sessionToken,
    user: loginContext.user,
    workspace: loginContext.workspace,
  };
}

export async function findAuthContextBySessionToken(
  database: DatabaseClient,
  sessionToken: string,
  now: Date = new Date(),
): Promise<AuthContext | null> {
  const tokenHash = hashSessionToken(sessionToken);
  const row = await database
    .selectFrom('auth_sessions')
    .innerJoin('users', 'users.id', 'auth_sessions.user_id')
    .innerJoin('workspaces', 'workspaces.owner_user_id', 'users.id')
    .select([
      'auth_sessions.id as sessionId',
      'users.id as userId',
      'users.email as email',
      'workspaces.id as workspaceId',
      'workspaces.name as workspaceName',
    ])
    .where('auth_sessions.token_hash', '=', tokenHash)
    .where('auth_sessions.revoked_at', 'is', null)
    .where('auth_sessions.expires_at', '>', now)
    .executeTakeFirst() as SessionContextRow | undefined;

  if (!row) {
    return null;
  }

  await database
    .updateTable('auth_sessions')
    .set({ last_seen_at: now })
    .where('id', '=', row.sessionId)
    .where('revoked_at', 'is', null)
    .execute();

  return {
    user: {
      id: row.userId,
      email: row.email,
    },
    workspace: {
      id: row.workspaceId,
      name: row.workspaceName,
    },
  };
}

export async function revokeSessionToken(
  database: DatabaseClient,
  sessionToken: string,
  now: Date = new Date(),
): Promise<void> {
  await database
    .updateTable('auth_sessions')
    .set({ revoked_at: now })
    .where('token_hash', '=', hashSessionToken(sessionToken))
    .where('revoked_at', 'is', null)
    .execute();
}

export async function acquireFirstOwnerSetupLock(database: AuthDatabase): Promise<void> {
  await sql`select pg_advisory_xact_lock(809711640, 80)`.execute(database);
}

async function hasAnyUsersInTransaction(database: AuthDatabase): Promise<boolean> {
  const row = await database.selectFrom('users').select('id').limit(1).executeTakeFirst();

  return row !== undefined;
}

async function insertOwnerUser(
  database: AuthDatabase,
  input: { email: string; passwordHash: string; now: Date },
): Promise<SetupUserRow> {
  const values = {
    email: input.email,
    password_hash: input.passwordHash,
    created_at: input.now,
    updated_at: input.now,
  } satisfies Insertable<DatabaseSchema['users']>;

  return database
    .insertInto('users')
    .values(values)
    .returning(['id', 'email'])
    .executeTakeFirstOrThrow() as Promise<SetupUserRow>;
}

async function insertOwnerWorkspace(
  database: AuthDatabase,
  input: { ownerUserId: string; name: string; now: Date },
): Promise<SetupWorkspaceRow> {
  const values = {
    owner_user_id: input.ownerUserId,
    name: input.name,
    created_at: input.now,
    updated_at: input.now,
  } satisfies Insertable<DatabaseSchema['workspaces']>;

  return database
    .insertInto('workspaces')
    .values(values)
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow() as Promise<SetupWorkspaceRow>;
}

async function insertAuthSession(
  database: AuthDatabase,
  input: { userId: string; tokenHash: string; now: Date },
): Promise<void> {
  const values = {
    user_id: input.userId,
    token_hash: input.tokenHash,
    created_at: input.now,
    last_seen_at: input.now,
    expires_at: new Date(input.now.getTime() + SESSION_MAX_AGE_SECONDS * 1000),
    revoked_at: null,
  } satisfies Insertable<DatabaseSchema['auth_sessions']>;

  await database.insertInto('auth_sessions').values(values).executeTakeFirstOrThrow();
}

async function findOwnerLoginContext(database: DatabaseClient, email: string): Promise<AuthContext & { passwordHash: string } | null> {
  const row = await database
    .selectFrom('users')
    .innerJoin('workspaces', 'workspaces.owner_user_id', 'users.id')
    .select([
      'users.id as userId',
      'users.email as email',
      'users.password_hash as passwordHash',
      'workspaces.id as workspaceId',
      'workspaces.name as workspaceName',
    ])
    .where('users.email', '=', email)
    .executeTakeFirst() as LoginRow | undefined;

  if (!row) {
    return null;
  }

  return {
    user: {
      id: row.userId,
      email: row.email,
    },
    workspace: {
      id: row.workspaceId,
      name: row.workspaceName,
    },
    passwordHash: row.passwordHash,
  };
}
