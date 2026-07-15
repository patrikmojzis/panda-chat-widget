import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4173;
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:3000';
const DEMO_ROOT = fileURLToPath(new URL('.', import.meta.url));

export function loadDemoServerConfig(env = process.env) {
  const host = parseHost(env.DEMO_HOST ?? env.HOST, DEFAULT_HOST);
  const port = parsePort(env.DEMO_PORT ?? env.PORT, DEFAULT_PORT);

  return {
    host,
    port,
    backendUrl: parseBackendUrl(env.DEMO_BACKEND_URL ?? env.BACKEND_URL, DEFAULT_BACKEND_URL),
    rootDir: DEMO_ROOT,
    widgetDistDir: path.join(DEMO_ROOT, 'widget-dist'),
    synthesizedOrigin: `http://127.0.0.1:${port}`,
  };
}

export function createDemoServer(config = loadDemoServerConfig()) {
  const backendUrl = new URL(config.backendUrl);
  const rootDir = path.resolve(config.rootDir);
  const widgetDistDir = path.resolve(config.widgetDistDir);

  return http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://panda-chat-widget.local');

    if (requestUrl.pathname.startsWith('/api/')) {
      proxyApiRequest({ backendUrl, request, response, synthesizedOrigin: config.synthesizedOrigin });
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'Method not allowed');
      return;
    }

    if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
      void serveFile(response, path.join(rootDir, 'index.html'), request.method);
      return;
    }

    if (requestUrl.pathname === '/esm.html' || requestUrl.pathname === '/esm') {
      void serveFile(response, path.join(rootDir, 'esm.html'), request.method);
      return;
    }

    if (requestUrl.pathname === '/widget.html') {
      void serveFile(response, path.join(widgetDistDir, 'index.html'), request.method);
      return;
    }

    if (requestUrl.pathname.startsWith('/vendor/') || requestUrl.pathname.startsWith('/assets/')) {
      const fileRoot = requestUrl.pathname.startsWith('/assets/') ? widgetDistDir : rootDir;
      const filePath = resolveSafeFile(fileRoot, requestUrl.pathname);

      if (!filePath) {
        sendText(response, 404, 'Not found');
        return;
      }

      void serveFile(response, filePath, request.method);
      return;
    }

    sendText(response, 404, 'Not found');
  });
}

export async function startDemoServer(config = loadDemoServerConfig()) {
  const server = createDemoServer(config);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  console.log(`Panda chat widget demo listening at http://${config.host}:${config.port}`);
  console.log(`Proxying /api/* to ${config.backendUrl}`);

  return server;
}

function proxyApiRequest({ backendUrl, request, response, synthesizedOrigin }) {
  const targetUrl = new URL(request.url ?? '/', backendUrl);
  const headers = { ...request.headers, host: targetUrl.host };

  if (!headers.origin) {
    headers.origin = synthesizedOrigin;
  }

  delete headers.connection;

  const proxyClient = targetUrl.protocol === 'https:' ? https : http;
  const upstreamRequest = proxyClient.request(
    targetUrl,
    {
      method: request.method,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstreamRequest.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    }

    response.end(JSON.stringify({ error: 'demo_proxy_error' }));
  });

  request.on('aborted', () => upstreamRequest.destroy());
  response.on('close', () => upstreamRequest.destroy());
  request.pipe(upstreamRequest);
}

async function serveFile(response, filePath, method) {
  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      sendText(response, 404, 'Not found');
      return;
    }

    response.writeHead(200, {
      'content-length': fileStat.size,
      'content-type': contentTypeForPath(filePath),
    });

    if (method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      sendText(response, 404, 'Not found');
      return;
    }

    sendText(response, 500, 'Internal server error');
  }
}

function resolveSafeFile(rootDir, requestPath) {
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const filePath = path.resolve(rootDir, decodedPath.replace(/^\/+/, ''));
  const relativePath = path.relative(rootDir, filePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return filePath;
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(message);
}

function contentTypeForPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function parseHost(value, defaultValue) {
  const host = (value ?? defaultValue).trim();

  if (!host) {
    throw new Error('Invalid demo HOST: expected a non-empty host');
  }

  return host;
}

function parsePort(value, defaultValue) {
  const rawPort = String(value ?? defaultValue).trim();

  if (!/^\d+$/.test(rawPort)) {
    throw new Error('Invalid demo PORT: expected an integer from 1 to 65535');
  }

  const port = Number(rawPort);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid demo PORT: expected an integer from 1 to 65535');
  }

  return port;
}

function parseBackendUrl(value, defaultValue) {
  const rawUrl = (value ?? defaultValue).trim();
  const parsedUrl = new URL(rawUrl);

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Invalid demo BACKEND_URL: expected an http:// or https:// URL');
  }

  return parsedUrl.toString().replace(/\/$/, '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startDemoServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
