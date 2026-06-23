import type { FastifyInstance } from 'fastify';

export type HealthResponse = {
  ok: true;
};

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/healthz', async (): Promise<HealthResponse> => ({ ok: true }));
}
