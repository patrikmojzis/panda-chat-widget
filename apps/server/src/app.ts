import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { registerHealthRoutes } from './health.ts';

export type BuildAppOptions = FastifyServerOptions;

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify(options);

  registerHealthRoutes(app);

  return app;
}
