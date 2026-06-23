import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export type BuildAppOptions = FastifyServerOptions;

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  return Fastify(options);
}
