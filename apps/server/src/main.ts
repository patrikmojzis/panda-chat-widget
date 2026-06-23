import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { listen } from './listen.ts';

const config = loadConfig();
const app = buildApp({ logger: config.logger });

try {
  await listen(app, config.listen);
} catch (error) {
  app.log.error({ err: error }, 'server failed to start');
  process.exitCode = 1;
}
