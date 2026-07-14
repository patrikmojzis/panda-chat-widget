import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildApp } from './app.ts';
import { resolveStaticFile } from './static-files.ts';

async function createBuiltAssetsFixture(): Promise<{
  loaderDistPath: string;
  referenceDistPath: string;
  rootPath: string;
  widgetDistPath: string;
}> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'panda-chat-built-assets-'));
  const loaderDistPath = path.join(rootPath, 'loader');
  const referenceDistPath = path.join(rootPath, 'reference');
  const widgetDistPath = path.join(rootPath, 'widget');

  await mkdir(loaderDistPath, { recursive: true });
  await mkdir(path.join(referenceDistPath, 'vendor'), { recursive: true });
  await mkdir(path.join(widgetDistPath, 'assets'), { recursive: true });
  await writeFile(path.join(rootPath, 'outside.txt'), 'must not be served');
  await writeFile(path.join(loaderDistPath, 'panda-chat-widget-loader.js'), 'console.log("built loader");');
  await writeFile(path.join(referenceDistPath, 'index.html'), '<!doctype html><h1>Reference host</h1>');
  await writeFile(
    path.join(referenceDistPath, 'vendor', 'panda-chat-widget-loader.js'),
    'console.log("reference loader");',
  );
  await writeFile(path.join(widgetDistPath, 'index.html'), '<!doctype html><div id="root">Built widget</div>');
  await writeFile(path.join(widgetDistPath, 'assets', 'widget.js'), 'console.log("built widget");');
  await writeFile(path.join(widgetDistPath, 'assets', 'widget.css'), 'body { color: black; }');
  await writeFile(path.join(widgetDistPath, 'assets', 'mark.svg'), '<svg></svg>');

  return { loaderDistPath, referenceDistPath, rootPath, widgetDistPath };
}

test('built Fastify serves widget, loader, and reference artifacts with their MIME types', async () => {
  const fixture = await createBuiltAssetsFixture();
  const app = buildApp({ assets: fixture });

  try {
    const widget = await app.inject({ method: 'GET', url: '/widget.html?publicKey=demo-local-widget' });
    const javascript = await app.inject({ method: 'GET', url: '/assets/widget.js' });
    const stylesheet = await app.inject({ method: 'GET', url: '/assets/widget.css' });
    const svg = await app.inject({ method: 'GET', url: '/assets/mark.svg' });
    const loader = await app.inject({ method: 'GET', url: '/vendor/panda-chat-widget-loader.js' });
    const referenceRedirect = await app.inject({ method: 'GET', url: '/reference' });
    const reference = await app.inject({ method: 'GET', url: '/reference/' });
    const referenceLoader = await app.inject({
      method: 'GET',
      url: '/reference/vendor/panda-chat-widget-loader.js',
    });

    assert.equal(widget.statusCode, 200);
    assert.match(widget.headers['content-type'] ?? '', /^text\/html/);
    assert.match(widget.body, /Built widget/);
    assert.equal(javascript.statusCode, 200);
    assert.match(javascript.headers['content-type'] ?? '', /^text\/javascript/);
    assert.match(javascript.body, /built widget/);
    assert.equal(stylesheet.statusCode, 200);
    assert.match(stylesheet.headers['content-type'] ?? '', /^text\/css/);
    assert.equal(svg.statusCode, 200);
    assert.match(svg.headers['content-type'] ?? '', /^image\/svg\+xml/);
    assert.equal(loader.statusCode, 200);
    assert.match(loader.headers['content-type'] ?? '', /^text\/javascript/);
    assert.match(loader.body, /built loader/);
    assert.equal(referenceRedirect.statusCode, 302);
    assert.equal(referenceRedirect.headers.location, '/reference/');
    assert.equal(reference.statusCode, 200);
    assert.match(reference.headers['content-type'] ?? '', /^text\/html/);
    assert.match(reference.body, /Reference host/);
    assert.equal(referenceLoader.statusCode, 200);
    assert.match(referenceLoader.body, /reference loader/);
  } finally {
    await app.close();
    await rm(fixture.rootPath, { force: true, recursive: true });
  }
});

test('built static routes reject missing files and raw, encoded, or malformed traversal', async () => {
  const fixture = await createBuiltAssetsFixture();
  const app = buildApp({ assets: fixture });

  try {
    for (const url of [
      '/assets/missing.js',
      '/assets/../outside.txt',
      '/assets/%2e%2e/outside.txt',
      '/assets/%2E%2E%2Foutside.txt',
      '/vendor/../outside.txt',
      '/vendor/%2e%2e/outside.txt',
      '/reference/../outside.txt',
      '/reference/%2e%2e/outside.txt',
    ]) {
      const response = await app.inject({ method: 'GET', url });

      assert.equal(response.statusCode, 404, url);
      assert.doesNotMatch(response.body, /must not be served/, url);
    }

    const malformedPath = await app.inject({ method: 'GET', url: '/assets/%E0%A4%A' });
    assert.equal(malformedPath.statusCode, 400);
    assert.doesNotMatch(malformedPath.body, /must not be served/);

    assert.equal(resolveStaticFile(fixture.widgetDistPath, '/assets/widget.js'), path.join(
      fixture.widgetDistPath,
      'assets',
      'widget.js',
    ));
    assert.equal(resolveStaticFile(fixture.widgetDistPath, '/assets/../outside.txt'), null);
    assert.equal(resolveStaticFile(fixture.widgetDistPath, '/assets/%2e%2e/outside.txt'), null);
    assert.equal(resolveStaticFile(fixture.widgetDistPath, '/assets/%E0%A4%A'), null);
    assert.equal(resolveStaticFile(fixture.widgetDistPath, '/assets/%5coutside.txt'), null);
  } finally {
    await app.close();
    await rm(fixture.rootPath, { force: true, recursive: true });
  }
});
