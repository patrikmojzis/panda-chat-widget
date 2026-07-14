import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { buildApp } from '../dist/app.js';
import { MIGRATIONS_DIRECTORY } from '../dist/migration-runner.js';

const execFileAsync = promisify(execFile);
const serverPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const serverDistPath = new URL('../dist/', import.meta.url).pathname;

function createConsoleAuthDatabase() {
  const selectQuery = {
    innerJoin: () => selectQuery,
    select: () => selectQuery,
    where: () => selectQuery,
    executeTakeFirst: async () => ({
      sessionId: 'session-1',
      userId: 'user-1',
      email: 'owner@example.test',
      workspaceId: 'workspace-1',
      workspaceName: 'Acme Support',
    }),
  };
  const updateQuery = {
    set: () => updateQuery,
    where: () => updateQuery,
    execute: async () => undefined,
  };

  return {
    selectFrom: () => selectQuery,
    updateTable: () => updateQuery,
  };
}

test('server build contains only executable JavaScript and compiled migrations', async () => {
  const files = await listFiles(serverDistPath);
  const migrationFiles = await readdir(MIGRATIONS_DIRECTORY);

  assert.ok(files.includes('main.js'));
  assert.ok(files.includes('migrate.js'));
  assert.ok(files.includes('seed.js'));
  assert.equal(files.some((file) => file.includes('.test.') || file.endsWith('.ts')), false);
  assert.deepEqual(migrationFiles.sort(), [
    '0001_initial_widget_tables.js',
    '0002_auth_workspace_foundation.js',
    '0003_widget_safe_bootstrap_settings.js',
    '0004_widget_panda_connection_placeholder.js',
    '0005_panda_delivery_intents.js',
    '0006_panda_delivery_intent_claims.js',
  ]);

  for (const migrationFile of migrationFiles) {
    const migration = await import(pathToFileURL(path.join(MIGRATIONS_DIRECTORY, migrationFile)).href);
    assert.equal(typeof migration.up, 'function', migrationFile);
    assert.equal(typeof migration.down, 'function', migrationFile);
  }

  for (const file of files.filter((name) => name.endsWith('.js'))) {
    const source = await readFile(path.join(serverDistPath, file), 'utf8');
    assert.doesNotMatch(source, /(?:from\s+|import\()['"]\.{1,2}\/[^'"]+\.ts['"]/, file);
  }

  assert.equal(serverPackage.scripts.start, 'node dist/main.js');
  assert.equal(serverPackage.scripts['db:migrate'], 'node dist/migrate.js');
  assert.equal(serverPackage.scripts['db:seed'], 'node dist/seed.js');
  for (const script of Object.entries(serverPackage.scripts).filter(([name]) => name.startsWith('local-panda:'))) {
    assert.match(script[1], /^node dist\/.+\.js$/, script[0]);
  }
});

test('compiled Fastify serves actual hashed builds and keeps console protection intact', async () => {
  const app = buildApp({ database: createConsoleAuthDatabase() });

  try {
    const widget = await app.inject({ method: 'GET', url: '/widget.html?publicKey=demo-local-widget' });
    const widgetAssetPaths = [...widget.body.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)]
      .map((match) => match[1]);
    const loader = await app.inject({ method: 'GET', url: '/vendor/panda-chat-widget-loader.js' });
    const reference = await app.inject({ method: 'GET', url: '/reference/' });
    const referenceIndex = await app.inject({ method: 'GET', url: '/reference/index.html' });
    const referenceLoader = await app.inject({
      method: 'GET',
      url: '/reference/vendor/panda-chat-widget-loader.js',
    });
    const login = await app.inject({ method: 'GET', url: '/console/login' });
    const consoleAssetPaths = [...login.body.matchAll(/(?:src|href)="(\/console\/assets\/[^"]+\.(?:js|css))"/g)]
      .map((match) => match[1]);
    const protectedDeepLink = await app.inject({ method: 'GET', url: '/console/sites/site-1/widgets/widget-1' });
    const authenticatedDeepLink = await app.inject({
      method: 'GET',
      url: '/console/sites/site-1/widgets/widget-1',
      headers: { cookie: `pcw_session=${'D'.repeat(43)}` },
    });
    const directConsoleIndex = await app.inject({ method: 'GET', url: '/console/index.html' });

    assert.equal(widget.statusCode, 200);
    assert.match(widget.headers['content-type'] ?? '', /^text\/html/);
    assert.equal(widgetAssetPaths.length, 2);
    for (const assetPath of widgetAssetPaths) {
      const response = await app.inject({ method: 'GET', url: assetPath });
      assert.equal(response.statusCode, 200, assetPath);
      assert.match(
        response.headers['content-type'] ?? '',
        assetPath.endsWith('.js') ? /^text\/javascript/ : /^text\/css/,
        assetPath,
      );
    }

    assert.equal(loader.statusCode, 200);
    assert.match(loader.headers['content-type'] ?? '', /^text\/javascript/);
    assert.match(loader.body, /PandaChatWidgetLoader/);
    assert.equal(reference.statusCode, 200);
    assert.equal(referenceIndex.statusCode, 200);
    assert.match(reference.body, /Panda Chat Widget loader demo/);
    assert.equal(referenceLoader.statusCode, 200);
    assert.match(referenceLoader.body, /PandaChatWidgetLoader/);
    assert.equal(login.statusCode, 200);
    assert.equal(consoleAssetPaths.length, 2);
    for (const assetPath of consoleAssetPaths) {
      const response = await app.inject({ method: 'GET', url: assetPath });
      assert.equal(response.statusCode, 200, assetPath);
      assert.match(
        response.headers['content-type'] ?? '',
        assetPath.endsWith('.js') ? /^text\/javascript/ : /^text\/css/,
        assetPath,
      );
    }

    assert.equal(protectedDeepLink.statusCode, 302);
    assert.equal(protectedDeepLink.headers.location, '/console/login');
    assert.equal(authenticatedDeepLink.statusCode, 200);
    assert.match(authenticatedDeepLink.body, /<div id="root"><\/div>/);
    assert.equal(directConsoleIndex.statusCode, 404);

    const malformedPath = await app.inject({ method: 'GET', url: '/assets/%E0%A4%A' });
    assert.equal(malformedPath.statusCode, 400);
    assert.doesNotMatch(malformedPath.body, /<div id="root"><\/div>|"scripts"/);

    for (const url of [
      '/assets/missing.js',
      '/assets/../package.json',
      '/assets/%2e%2e/package.json',
      '/assets/%252e%252e/package.json',
      '/vendor/%2e%2e/package.json',
      '/reference/%2e%2e/package.json',
      '/console/assets/%2e%2e/index.html',
      '/console/assets/%252e%252e/index.html',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 404, url);
      assert.doesNotMatch(response.body, /<div id="root"><\/div>|"scripts"/, url);
    }
  } finally {
    await app.close();
  }
});

test('compiled app resolves built assets from import.meta.url outside the repository cwd', async () => {
  const temporaryCwd = await mkdtemp(path.join(os.tmpdir(), 'panda-chat-built-cwd-'));
  const appUrl = new URL('../dist/app.js', import.meta.url).href;
  const script = `
    const { buildApp } = await import(${JSON.stringify(appUrl)});
    const app = buildApp();
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    const widget = await app.inject({ method: 'GET', url: '/widget.html?publicKey=demo-local-widget' });
    const reference = await app.inject({ method: 'GET', url: '/reference/' });
    console.log(JSON.stringify({ health: health.statusCode, widget: widget.statusCode, reference: reference.statusCode }));
    await app.close();
  `;

  try {
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: temporaryCwd,
    });

    assert.deepEqual(JSON.parse(stdout), { health: 200, widget: 200, reference: 200 });
  } finally {
    await rm(temporaryCwd, { force: true, recursive: true });
  }
});

async function listFiles(rootPath, relativePath = '') {
  const entries = await readdir(path.join(rootPath, relativePath), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFiles(rootPath, entryPath));
    } else {
      files.push(entryPath);
    }
  }

  return files.sort();
}
