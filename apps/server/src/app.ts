import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { type AuthRouteOptions, registerAuthRoutes } from './auth-routes.ts';
import { registerConsoleStaticRoutes } from './console-static.ts';
import { registerConversationRoutes } from './conversation.ts';
import type { DatabaseClient } from './db.ts';
import {
  createConversationMessageEventEmitter,
  type ConversationMessageEventEmitter,
} from './message-events.ts';
import { registerDashboardRoutes } from './dashboard.ts';
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
  auth?: Partial<Omit<AuthRouteOptions, 'database'>> & { secureCookies?: boolean };
  console?: { distPath?: string };
  database?: DatabaseClient;
  messageEvents?: ConversationMessageEventEmitter;
  publicWriteRateLimit?: PublicWriteRateLimitHook;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const {
    auth,
    console: consoleOptions,
    database,
    messageEvents,
    publicWriteRateLimit = allowAllPublicWriteRateLimit,
    ...fastifyOptions
  } = options;

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
    const authOptions = {
      ...auth,
      database,
      secureCookies: auth?.secureCookies ?? false,
    };

    registerAuthRoutes(app, authOptions);
    registerDashboardRoutes(app, { database });
    registerConsoleStaticRoutes(
      app,
      consoleOptions?.distPath === undefined
        ? { database }
        : { database, distPath: consoleOptions.distPath },
    );
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
