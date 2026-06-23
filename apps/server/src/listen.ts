import type { FastifyInstance } from 'fastify';

export type ListenOptions = {
  host: string;
  port: number;
};

export function listen(app: FastifyInstance, options: ListenOptions): Promise<string> {
  return app.listen(options);
}
