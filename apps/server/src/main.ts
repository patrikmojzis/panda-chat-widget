import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { listen } from './listen.ts';
import { safeErrorForLog } from './server-logging.ts';

const config = loadConfig();
const app = buildApp({ logger: config.logger });

try {
  await listen(app, config.listen);
} catch (error) {
  app.log.error({ error: safeErrorForLog(error) }, 'server failed to start');
  process.exitCode = 1;
}
