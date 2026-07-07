import type { FastifyInstance } from 'fastify';

import { requireAuthenticatedApi, setNoStore, type AuthErrorResponse } from './auth-guard.ts';
import type { AuthContext } from './auth-validation.ts';
import type { DatabaseClient } from './db.ts';

export type DashboardRouteOptions = {
  database: DatabaseClient;
};

export type DashboardHomeResponse = AuthContext & {
  dashboard: {
    title: string;
    message: string;
  };
};

type DashboardRoute = {
  Reply: DashboardHomeResponse | AuthErrorResponse;
};

export function registerDashboardRoutes(app: FastifyInstance, options: DashboardRouteOptions): void {
  app.get<DashboardRoute>('/api/dashboard', async (request, reply) => {
    setNoStore(reply);
    const auth = await requireAuthenticatedApi(options.database, request, reply);

    if (!auth) {
      return;
    }

    return reply.send({
      ...auth,
      dashboard: {
        title: 'Dashboard',
        message: 'Your Panda Chat Widget console is ready.',
      },
    });
  });
}
