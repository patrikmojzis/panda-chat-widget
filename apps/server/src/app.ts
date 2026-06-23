import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { registerConversationRoutes } from './conversation.ts';
import type { DatabaseClient } from './db.ts';
import {
  createConversationMessageEventEmitter,
  type ConversationMessageEventEmitter,
} from './message-events.ts';
import { registerHealthRoutes } from './health.ts';
import { registerVisitorMessageRoutes } from './visitor-message.ts';
import { registerVisitorSessionRoutes } from './visitor-session.ts';
import { registerWidgetBootstrapRoutes } from './widget-bootstrap.ts';

export type BuildAppOptions = FastifyServerOptions & {
  database?: DatabaseClient;
  messageEvents?: ConversationMessageEventEmitter;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const { database, messageEvents, ...fastifyOptions } = options;
  const app = Fastify(fastifyOptions);

  registerHealthRoutes(app);

  if (database) {
    registerWidgetBootstrapRoutes(app, { database });
    registerVisitorSessionRoutes(app, { database });
    registerConversationRoutes(app, { database });
    registerVisitorMessageRoutes(app, {
      database,
      messageEvents: messageEvents ?? createConversationMessageEventEmitter(),
    });
  }

  return app;
}
