import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { registerConversationRoutes } from './conversation.ts';
import type { DatabaseClient } from './db.ts';
import {
  createConversationMessageEventEmitter,
  type ConversationMessageEventEmitter,
} from './message-events.ts';
import { registerHealthRoutes } from './health.ts';
import {
  allowAllPublicWriteRateLimit,
  type PublicWriteRateLimitHook,
} from './rate-limit.ts';
import { createSafeLoggerOptions, safeErrorForLog } from './server-logging.ts';
import { registerVisitorMessageRoutes } from './visitor-message.ts';
import { registerVisitorSessionRoutes } from './visitor-session.ts';
import { registerWidgetBootstrapRoutes } from './widget-bootstrap.ts';

export type BuildAppOptions = FastifyServerOptions & {
  database?: DatabaseClient;
  messageEvents?: ConversationMessageEventEmitter;
  publicWriteRateLimit?: PublicWriteRateLimitHook;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const { database, messageEvents, publicWriteRateLimit = allowAllPublicWriteRateLimit, ...fastifyOptions } = options;

  if (fastifyOptions.logger === true) {
    fastifyOptions.logger = createSafeLoggerOptions(true);
  }

  const app = Fastify(fastifyOptions);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error: safeErrorForLog(error) }, 'request failed');
    return reply.status(500).send({ error: 'internal_server_error' });
  });

  registerHealthRoutes(app);

  if (database) {
    registerWidgetBootstrapRoutes(app, { database });
    registerVisitorSessionRoutes(app, { database, publicWriteRateLimit });
    registerConversationRoutes(app, { database, publicWriteRateLimit });
    registerVisitorMessageRoutes(app, {
      database,
      messageEvents: messageEvents ?? createConversationMessageEventEmitter(),
      publicWriteRateLimit,
    });
  }

  return app;
}
