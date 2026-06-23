import { buildApp } from './app.ts';
import { listen, type ListenOptions } from './listen.ts';

const defaultListenOptions = {
  host: '127.0.0.1',
  port: 3000,
} satisfies ListenOptions;

const app = buildApp({ logger: true });

try {
  await listen(app, defaultListenOptions);
} catch (error) {
  app.log.error({ err: error }, 'server failed to start');
  process.exitCode = 1;
}
