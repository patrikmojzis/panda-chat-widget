import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { registerConversationRoutes } from './conversation.ts';
import type { DatabaseClient } from './db.ts';
import { registerHealthRoutes } from './health.ts';
import { registerVisitorSessionRoutes } from './visitor-session.ts';
import { registerWidgetBootstrapRoutes } from './widget-bootstrap.ts';

export type BuildAppOptions = FastifyServerOptions & {
  database?: DatabaseClient;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const { database, ...fastifyOptions } = options;
  const app = Fastify(fastifyOptions);

  registerHealthRoutes(app);

  if (database) {
    registerWidgetBootstrapRoutes(app, { database });
    registerVisitorSessionRoutes(app, { database });
    registerConversationRoutes(app, { database });
  }

  return app;
}
