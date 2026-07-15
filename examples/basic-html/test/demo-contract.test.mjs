import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDemoServer, loadDemoServerConfig } from '../dev-server.mjs';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');

test('basic HTML demo build prepares loader and widget UI artifacts', () => {
  assert.equal(packageJson.scripts.dev, 'node dev-server.mjs');
  assert.equal(packageJson.dependencies['@panda-chat-widget/loader'], 'workspace:*');
  assert.equal(packageJson.dependencies['@panda-chat-widget/widget-ui'], 'workspace:*');
  assert.match(packageJson.scripts.build, /vendor\/panda-chat-widget-loader\.js/);
  assert.match(packageJson.scripts.build, /widget-dist/);
  assert.match(packageJson.scripts.build, /dist\/index\.html/);
  assert.match(packageJson.scripts.build, /dist\/esm\.html/);
  assert.match(packageJson.scripts.build, /dist\/vendor\/index\.js/);
  assert.match(packageJson.scripts.build, /dist\/vendor\/panda-chat-widget-loader\.js/);
  assert.equal(packageJson.scripts.test, 'node --test "test/**/*.test.mjs"');
  assert.match(gitignore, /^\/vendor\/$/m);
  assert.match(gitignore, /^\/widget-dist\/$/m);
});

test('basic HTML demo loads the loader with the stable demo widget key', () => {
  assert.match(indexHtml, /\.\/vendor\/panda-chat-widget-loader\.js/);
  assert.match(indexHtml, /data-site-key="demo-local-widget"/);
  assert.match(indexHtml, /bottom-right launcher/);
  assert.doesNotMatch(indexHtml, /fetch\(|XMLHttpRequest|postMessage|innerHTML/);
});


test('basic HTML demo ESM page loads the ESM factory with explicit init', async () => {
  const esmHtml = await readFile(new URL('../esm.html', import.meta.url), 'utf8');
  assert.match(esmHtml, /createPandaChatWidget/);
  assert.match(esmHtml, /\.init\(/);
  assert.match(esmHtml, /\.destroy\(/);
  assert.match(esmHtml, /type="module"/);
  assert.match(esmHtml, /\/vendor\/index\.js/);
  assert.doesNotMatch(esmHtml, /postMessage|innerHTML/);
  assert.match(esmHtml, /temporary iframe-load readiness/);
});

test('demo server defaults to local host, port, backend, and localhost proxy origin', () => {
  assert.deepEqual(loadDemoServerConfig({}), {
    host: '127.0.0.1',
    port: 4173,
    backendUrl: 'http://127.0.0.1:3000',
    rootDir: new URL('../', import.meta.url).pathname,
    widgetDistDir: path.join(new URL('../', import.meta.url).pathname, 'widget-dist'),
    synthesizedOrigin: 'http://127.0.0.1:4173',
  });
});

test('demo server serves host page, loader, widget iframe app, and widget assets', async () => {
  const rootDir = await createDemoFixture();
  const server = createDemoServer({
    host: '127.0.0.1',
    port: 0,
    backendUrl: 'http://127.0.0.1:1',
    rootDir,
    widgetDistDir: path.join(rootDir, 'widget-dist'),
    synthesizedOrigin: 'http://127.0.0.1:4173',
  });

  await listen(server);

  try {
    const baseUrl = serverUrl(server);
    const hostPage = await fetchText(`${baseUrl}/`);
    const loader = await fetchText(`${baseUrl}/vendor/panda-chat-widget-loader.js`);
    const widget = await fetchText(`${baseUrl}/widget.html?publicKey=demo-local-widget`);
    const asset = await fetchText(`${baseUrl}/assets/widget.js`);

    assert.match(hostPage.body, /Host page/);
    assert.match(loader.body, /loader artifact/);
    assert.match(widget.body, /Built widget UI/);
    assert.match(asset.body, /widget asset/);
    assert.match(widget.contentType, /^text\/html/);
    assert.match(asset.contentType, /^text\/javascript/);
  } finally {
    await close(server);
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('demo server proxies /api requests to the backend with a synthesized localhost Origin when missing', async () => {
  const rootDir = await createDemoFixture();
  const seenRequests = [];
  const backend = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      seenRequests.push({
        method: request.method,
        url: request.url,
        origin: request.headers.origin,
        contentType: request.headers['content-type'],
        body,
      });
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true }));
    });
  });

  await listen(backend);

  const server = createDemoServer({
    host: '127.0.0.1',
    port: 0,
    backendUrl: serverUrl(backend),
    rootDir,
    widgetDistDir: path.join(rootDir, 'widget-dist'),
    synthesizedOrigin: 'http://127.0.0.1:4173',
  });

  await listen(server);

  try {
    const response = await fetch(`${serverUrl(server)}/api/widgets/demo-local-widget/visitor-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visitorKey: 'visitor_demo' }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(seenRequests, [
      {
        method: 'POST',
        url: '/api/widgets/demo-local-widget/visitor-session',
        origin: 'http://127.0.0.1:4173',
        contentType: 'application/json',
        body: '{"visitorKey":"visitor_demo"}',
      },
    ]);
  } finally {
    await close(server);
    await close(backend);
    await rm(rootDir, { force: true, recursive: true });
  }
});

test('demo server proxies widget message event streams without buffering them into static responses', async () => {
  const rootDir = await createDemoFixture();
  const backend = http.createServer((request, response) => {
    assert.equal(request.url, '/api/widgets/demo-local-widget/messages/events?visitorSessionId=vs_1&conversationId=cv_1');
    assert.equal(request.headers.accept, 'text/event-stream');
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    });
    response.write('event: ready\n');
    response.end('data: {}\n\n');
  });

  await listen(backend);

  const server = createDemoServer({
    host: '127.0.0.1',
    port: 0,
    backendUrl: serverUrl(backend),
    rootDir,
    widgetDistDir: path.join(rootDir, 'widget-dist'),
    synthesizedOrigin: 'http://127.0.0.1:4173',
  });

  await listen(server);

  try {
    const response = await fetch(
      `${serverUrl(server)}/api/widgets/demo-local-widget/messages/events?visitorSessionId=vs_1&conversationId=cv_1`,
      { headers: { accept: 'text/event-stream' } },
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
    assert.equal(await response.text(), 'event: ready\ndata: {}\n\n');
  } finally {
    await close(server);
    await close(backend);
    await rm(rootDir, { force: true, recursive: true });
  }
});

async function createDemoFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'panda-chat-basic-html-'));
  await mkdir(path.join(rootDir, 'vendor'), { recursive: true });
  await mkdir(path.join(rootDir, 'widget-dist', 'assets'), { recursive: true });
  await writeFile(path.join(rootDir, 'index.html'), '<!doctype html><title>Host page</title>');
  await writeFile(path.join(rootDir, 'vendor', 'panda-chat-widget-loader.js'), 'console.log("loader artifact");');
  await writeFile(path.join(rootDir, 'widget-dist', 'index.html'), '<!doctype html><h1>Built widget UI</h1>');
  await writeFile(path.join(rootDir, 'widget-dist', 'assets', 'widget.js'), 'console.log("widget asset");');

  return rootDir;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function serverUrl(server) {
  const address = server.address();

  assert.equal(typeof address, 'object');
  assert.notEqual(address, null);

  return `http://127.0.0.1:${address.port}`;
}

async function fetchText(url) {
  const response = await fetch(url);

  return {
    body: await response.text(),
    contentType: response.headers.get('content-type') ?? '',
  };
}
