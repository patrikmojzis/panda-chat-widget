import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as ts from 'typescript';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const buildConfig = JSON.parse(await readFile(new URL('../tsconfig.build.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../src/panda-chat-widget-loader.ts', import.meta.url), 'utf8');
const compiledLoader = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.None,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

class FakeElement {
  attributes = {};
  children = [];
  className = '';
  id = '';
  textContent = '';

  constructor(tagName) {
    this.tagName = tagName;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);

    if (name === 'id') {
      this.id = String(value);
    }

    if (name === 'class') {
      this.className = String(value);
    }
  }
}

function findElementById(element, id) {
  if (element.id === id) {
    return element;
  }

  for (const child of element.children) {
    const match = findElementById(child, id);

    if (match) {
      return match;
    }
  }

  return null;
}

function createFakeDocument(attributes) {
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  const currentScript = {
    getAttribute: (name) => (Object.hasOwn(attributes, name) ? attributes[name] : null),
  };

  return {
    body,
    currentScript,
    head,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => findElementById(head, id) ?? findElementById(body, id),
  };
}

function snapshotElement(element) {
  return {
    tagName: element.tagName,
    id: element.id,
    className: element.className,
    textContent: element.textContent,
    attributes: element.attributes,
    children: element.children.map(snapshotElement),
  };
}

function runLoader({ attributes = {}, initConfig } = {}) {
  const windowObject = {};
  const documentObject = createFakeDocument(attributes);

  if (initConfig !== undefined) {
    windowObject.PandaChatWidgetConfig = initConfig;
  }

  vm.runInNewContext(
    compiledLoader,
    {
      document: documentObject,
      window: windowObject,
    },
    { timeout: 1000 },
  );

  return {
    document: documentObject,
    loader: JSON.parse(JSON.stringify(windowObject.PandaChatWidgetLoader)),
  };
}

test('loader package builds one browser script artifact from the TypeScript entry', () => {
  assert.equal(packageJson.browser, 'dist/panda-chat-widget-loader.js');
  assert.equal(packageJson.main, 'dist/panda-chat-widget-loader.js');
  assert.equal(packageJson.scripts.build, 'tsc -p tsconfig.build.json');
  assert.deepEqual(buildConfig.include, ['src/panda-chat-widget-loader.ts']);
  assert.equal(buildConfig.compilerOptions.rootDir, './src');
  assert.equal(buildConfig.compilerOptions.outDir, './dist');
});

test('loader entry reads config and only creates launcher DOM', () => {
  assert.match(source, /resolveLoaderConfig/);
  assert.match(source, /mountLauncher/);
  assert.match(source, /panda-chat-widget-launcher/);
  assert.match(source, /panda-chat-widget-launcher-button/);
  assert.match(source, /data-site-key/);
  assert.match(source, /PandaChatWidgetConfig/);
  assert.match(source, /PandaChatWidgetLoader/);
  assert.doesNotMatch(source, /iframe|fetch\(|addEventListener|onclick|postMessage/);
});

test('loader resolves a site key from current script data attributes', () => {
  const { loader } = runLoader({ attributes: { 'data-site-key': ' demo-local-widget ' } });

  assert.deepEqual(loader, {
    version: '0.0.0',
    config: { status: 'configured', publicKey: 'demo-local-widget' },
  });
});

test('loader resolves a public key from tiny init config when script attributes are absent', () => {
  const { loader } = runLoader({ initConfig: { publicKey: ' init-widget-key ' } });

  assert.deepEqual(loader, {
    version: '0.0.0',
    config: { status: 'configured', publicKey: 'init-widget-key' },
  });
});

test('loader represents a missing key without throwing on the host page', () => {
  const { document, loader } = runLoader({ attributes: { 'data-site-key': '   ' } });

  assert.deepEqual(loader, {
    version: '0.0.0',
    config: { status: 'missing_key' },
  });
  assert.equal(document.getElementById('panda-chat-widget-loader-styles'), null);
  assert.equal(document.getElementById('panda-chat-widget-launcher'), null);
  assert.deepEqual(document.head.children, []);
  assert.deepEqual(document.body.children, []);
});

test('loader mounts one fixed bottom-right launcher for configured widgets', () => {
  const { document, loader } = runLoader({ attributes: { 'data-site-key': 'demo-local-widget' } });

  assert.equal(loader.config.status, 'configured');

  const styleElement = document.getElementById('panda-chat-widget-loader-styles');
  assert.ok(styleElement);
  assert.match(styleElement.textContent, /position: fixed/);
  assert.match(styleElement.textContent, /right: 20px/);
  assert.match(styleElement.textContent, /bottom: 20px/);
  assert.match(styleElement.textContent, /z-index: 2147483647/);

  const containerElement = document.getElementById('panda-chat-widget-launcher');
  assert.deepEqual(snapshotElement(containerElement), {
    tagName: 'div',
    id: 'panda-chat-widget-launcher',
    className: 'panda-chat-widget-launcher-container',
    textContent: '',
    attributes: {},
    children: [
      {
        tagName: 'button',
        id: '',
        className: 'panda-chat-widget-launcher-button',
        textContent: 'Chat',
        attributes: {
          'aria-label': 'Chat',
          type: 'button',
        },
        children: [],
      },
    ],
  });
  assert.deepEqual(document.head.children.map((element) => element.id), ['panda-chat-widget-loader-styles']);
  assert.deepEqual(document.body.children.map((element) => element.id), ['panda-chat-widget-launcher']);
});
