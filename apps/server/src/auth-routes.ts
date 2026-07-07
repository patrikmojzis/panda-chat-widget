import type { FastifyInstance } from 'fastify';

import {
  createFirstOwnerSetup,
  hasAnyUsers,
  loginOwner,
  revokeSessionToken,
  type AuthDataDependencies,
} from './auth-data.ts';
import {
  requireAuthenticatedApi,
  requireUnsafeRequestCsrf,
  setNoStore,
  type AuthErrorResponse,
  type CsrfErrorResponse,
} from './auth-guard.ts';
import {
  parseSessionCookieHeader,
  serializeSessionCookie,
  serializeSessionCookieClear,
} from './auth-session.ts';
import {
  parseLoginRequest,
  parseSetupRequest,
  type AuthResponseBody,
  type InvalidLoginReason,
  type InvalidSetupReason,
} from './auth-validation.ts';
import type { DatabaseClient } from './db.ts';

export type AuthRouteOptions = AuthDataDependencies & {
  database: DatabaseClient;
  secureCookies: boolean;
};

type SetupStatusResponse = {
  setupRequired: boolean;
};

type SetupRoute = {
  Body: unknown;
  Reply: AuthResponseBody | SetupErrorResponse;
};

type LoginRoute = {
  Body: unknown;
  Reply: AuthResponseBody | LoginErrorResponse;
};

type LogoutRoute = {
  Reply: AuthErrorResponse | CsrfErrorResponse | null;
};

type MeRoute = {
  Reply: AuthResponseBody | AuthErrorResponse;
};

type SetupErrorResponse =
  | {
      error: 'invalid_setup_request';
      reason: InvalidSetupReason;
    }
  | {
      error: 'setup_already_completed';
    };

type LoginErrorResponse =
  | {
      error: 'invalid_login_request';
      reason: InvalidLoginReason;
    }
  | {
      error: 'invalid_credentials';
    };

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  app.get<{ Reply: SetupStatusResponse }>('/api/auth/setup-status', async (_request, reply) => {
    setNoStore(reply);

    return reply.send({ setupRequired: !(await hasAnyUsers(options.database)) });
  });

  app.post<SetupRoute>('/api/auth/setup', async (request, reply) => {
    setNoStore(reply);
    const setupRequest = parseSetupRequest(request.body);

    if (setupRequest.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_setup_request', reason: setupRequest.reason });
    }

    const setup = await createFirstOwnerSetup(options.database, setupRequest.request, options);

    if (setup.status === 'setup_already_completed') {
      return reply.status(409).send({ error: 'setup_already_completed' });
    }

    return reply
      .status(201)
      .header('set-cookie', serializeSessionCookie(setup.sessionToken, { secure: options.secureCookies }))
      .send({ user: setup.user, workspace: setup.workspace });
  });

  app.post<LoginRoute>('/api/auth/login', async (request, reply) => {
    setNoStore(reply);
    const loginRequest = parseLoginRequest(request.body);

    if (loginRequest.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_login_request', reason: loginRequest.reason });
    }

    const login = await loginOwner(options.database, loginRequest.request, options);

    if (login.status === 'invalid_credentials') {
      return reply.status(401).send({ error: 'invalid_credentials' });
    }

    return reply
      .header('set-cookie', serializeSessionCookie(login.sessionToken, { secure: options.secureCookies }))
      .send({ user: login.user, workspace: login.workspace });
  });

  app.post<LogoutRoute>('/api/auth/logout', async (request, reply) => {
    setNoStore(reply);

    if (!(await requireUnsafeRequestCsrf(request, reply))) {
      return;
    }

    const cookie = parseSessionCookieHeader(request.headers.cookie);

    if (cookie.status === 'found') {
      await revokeSessionToken(options.database, cookie.token, options.now?.() ?? new Date());
    }

    return reply
      .status(204)
      .header('set-cookie', serializeSessionCookieClear({ secure: options.secureCookies }))
      .send(null);
  });

  app.get<MeRoute>('/api/me', async (request, reply) => {
    setNoStore(reply);
    const auth = await requireAuthenticatedApi(options.database, request, reply, options.now?.() ?? new Date());

    if (!auth) {
      return;
    }

    return reply.send(auth);
  });

  app.get<MeRoute>('/me', async (request, reply) => {
    setNoStore(reply);
    const auth = await requireAuthenticatedApi(options.database, request, reply, options.now?.() ?? new Date());

    if (!auth) {
      return;
    }

    return reply.send(auth);
  });
}
