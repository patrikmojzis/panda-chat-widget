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
  hidden = false;
  id = '';
  listeners = {};
  textContent = '';

  constructor(tagName) {
    this.tagName = tagName;
  }

  addEventListener(type, listener) {
    this.listeners[type] = this.listeners[type] ?? [];
    this.listeners[type].push(listener);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  click() {
    for (const listener of this.listeners.click ?? []) {
      listener({ currentTarget: this, type: 'click' });
    }
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
    hidden: element.hidden,
    textContent: element.textContent,
    attributes: element.attributes,
    children: element.children.map(snapshotElement),
  };
}

function runLoader({
  attributes = {},
  initConfig,
  locationHref = 'https://host.example/support/page?from=test#top',
} = {}) {
  const windowObject = { location: { href: locationHref } };
  const documentObject = createFakeDocument(attributes);

  if (initConfig !== undefined) {
    windowObject.PandaChatWidgetConfig = initConfig;
  }

  vm.runInNewContext(
    compiledLoader,
    {
      document: documentObject,
      URL,
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

test('loader entry reads config and creates a URL-built iframe shell', () => {
  assert.match(source, /resolveLoaderConfig/);
  assert.match(source, /buildWidgetIframeUrl/);
  assert.match(source, /new URL/);
  assert.match(source, /searchParams\.set\('publicKey'/);
  assert.match(source, /mountLauncher/);
  assert.match(source, /setOpen/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /aria-hidden/);
  assert.match(source, /Hide chat/);
  assert.match(source, /panda-chat-widget-launcher/);
  assert.match(source, /panda-chat-widget-launcher-button/);
  assert.match(source, /panda-chat-widget-panel/);
  assert.match(source, /panda-chat-widget-frame/);
  assert.match(source, /data-site-key/);
  assert.match(source, /PandaChatWidgetConfig/);
  assert.match(source, /PandaChatWidgetLoader/);
  assert.doesNotMatch(source, /fetch\(|innerHTML|onclick|postMessage/);
});

test('loader host styling is static and avoids arbitrary CSS or HTML injection APIs', () => {
  const styleTemplate = source.match(/styleElement\.textContent = `([\s\S]*?)`;/);

  assert.ok(styleTemplate, 'loader stylesheet literal should be easy to audit');
  assert.doesNotMatch(styleTemplate[1], /config|publicKey|widgetKey|siteKey|PandaChatWidgetConfig/);
  assert.match(source, /iframeUrl\.searchParams\.set\('publicKey', config\.publicKey\)/);
  assert.doesNotMatch(
    source,
    /dangerouslySetInnerHTML|\.innerHTML\b|insertAdjacentHTML|cssText|setAttribute\(['"]style|\.style\b|eval\(|new Function/,
  );
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
  assert.match(styleElement.textContent, /right: max\(16px, env\(safe-area-inset-right, 0px\)\)/);
  assert.match(styleElement.textContent, /bottom: max\(16px, env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(styleElement.textContent, /max-width: calc\(100vw - 32px - env\(safe-area-inset-left, 0px\) - env\(safe-area-inset-right, 0px\)\)/);
  assert.match(styleElement.textContent, /max-height: calc\(100vh - 32px - env\(safe-area-inset-top, 0px\) - env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(styleElement.textContent, /z-index: 2147483647/);
  assert.match(styleElement.textContent, /width: min\(380px, calc\(100vw - 32px - env\(safe-area-inset-left, 0px\) - env\(safe-area-inset-right, 0px\)\)\)/);
  assert.match(styleElement.textContent, /height: min\(640px, calc\(100vh - 104px - env\(safe-area-inset-top, 0px\) - env\(safe-area-inset-bottom, 0px\)\)\)/);
  assert.match(styleElement.textContent, /overflow: hidden/);
  assert.match(styleElement.textContent, /flex: 1 1 0/);
  assert.match(styleElement.textContent, /min-height: 0/);
  assert.match(styleElement.textContent, /\[data-state="open"\] \.panda-chat-widget-launcher-button/);
  assert.match(styleElement.textContent, /\.panda-chat-widget-panel-close:focus-visible,[\s\S]*\.panda-chat-widget-launcher-button:focus-visible/);

  const containerElement = document.getElementById('panda-chat-widget-launcher');
  assert.deepEqual(snapshotElement(containerElement), {
    tagName: 'div',
    id: 'panda-chat-widget-launcher',
    className: 'panda-chat-widget-launcher-container',
    hidden: false,
    textContent: '',
    attributes: {
      'data-state': 'closed',
    },
    children: [
      {
        tagName: 'div',
        id: 'panda-chat-widget-panel',
        className: 'panda-chat-widget-panel',
        hidden: true,
        textContent: '',
        attributes: {
          'aria-hidden': 'true',
          'aria-label': 'Chat widget',
          role: 'dialog',
        },
        children: [
          {
            tagName: 'button',
            id: '',
            className: 'panda-chat-widget-panel-close',
            hidden: false,
            textContent: 'Close',
            attributes: {
              'aria-label': 'Close chat',
              type: 'button',
            },
            children: [],
          },
          {
            tagName: 'iframe',
            id: '',
            className: 'panda-chat-widget-frame',
            hidden: false,
            textContent: '',
            attributes: {
              src: 'https://host.example/widget.html?publicKey=demo-local-widget',
              title: 'Panda chat widget',
            },
            children: [],
          },
        ],
      },
      {
        tagName: 'button',
        id: '',
        className: 'panda-chat-widget-launcher-button',
        hidden: false,
        textContent: 'Chat',
        attributes: {
          'aria-controls': 'panda-chat-widget-panel',
          'aria-expanded': 'false',
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

test('loader toggles the launcher panel open and closed', () => {
  const { document } = runLoader({ attributes: { 'data-site-key': 'demo-local-widget' } });
  const containerElement = document.getElementById('panda-chat-widget-launcher');
  const panelElement = document.getElementById('panda-chat-widget-panel');
  const launcherButton = containerElement.children[1];

  assert.equal(containerElement.attributes['data-state'], 'closed');
  assert.equal(panelElement.hidden, true);
  assert.equal(panelElement.attributes['aria-hidden'], 'true');
  assert.equal(launcherButton.textContent, 'Chat');
  assert.equal(launcherButton.attributes['aria-expanded'], 'false');
  assert.equal(launcherButton.attributes['aria-label'], 'Chat');

  launcherButton.click();

  assert.equal(containerElement.attributes['data-state'], 'open');
  assert.equal(panelElement.hidden, false);
  assert.equal(panelElement.attributes['aria-hidden'], 'false');
  assert.equal(launcherButton.textContent, 'Hide chat');
  assert.equal(launcherButton.attributes['aria-expanded'], 'true');
  assert.equal(launcherButton.attributes['aria-label'], 'Hide chat');

  launcherButton.click();

  assert.equal(containerElement.attributes['data-state'], 'closed');
  assert.equal(panelElement.hidden, true);
  assert.equal(panelElement.attributes['aria-hidden'], 'true');
  assert.equal(launcherButton.textContent, 'Chat');
  assert.equal(launcherButton.attributes['aria-expanded'], 'false');
  assert.equal(launcherButton.attributes['aria-label'], 'Chat');
});

test('loader panel close button returns the launcher to closed state', () => {
  const { document } = runLoader({ attributes: { 'data-site-key': 'demo-local-widget' } });
  const containerElement = document.getElementById('panda-chat-widget-launcher');
  const panelElement = document.getElementById('panda-chat-widget-panel');
  const closeButton = panelElement.children[0];
  const launcherButton = containerElement.children[1];

  launcherButton.click();
  assert.equal(containerElement.attributes['data-state'], 'open');
  assert.equal(panelElement.hidden, false);
  assert.equal(panelElement.attributes['aria-hidden'], 'false');
  assert.equal(launcherButton.textContent, 'Hide chat');

  closeButton.click();

  assert.equal(containerElement.attributes['data-state'], 'closed');
  assert.equal(panelElement.hidden, true);
  assert.equal(panelElement.attributes['aria-hidden'], 'true');
  assert.equal(launcherButton.textContent, 'Chat');
  assert.equal(launcherButton.attributes['aria-expanded'], 'false');
  assert.equal(launcherButton.attributes['aria-label'], 'Chat');
});

test('loader iframe URL uses host origin and encodes the public key search param', () => {
  const publicKey = 'demo key/with?chars';
  const { document } = runLoader({
    attributes: { 'data-site-key': publicKey },
    locationHref: 'https://customer.example/help/articles?utm=keep#section',
  });
  const iframeElement = document.getElementById('panda-chat-widget-panel').children[1];
  const iframeUrl = new URL(iframeElement.attributes.src);

  assert.equal(iframeElement.tagName, 'iframe');
  assert.equal(iframeElement.attributes.src, 'https://customer.example/widget.html?publicKey=demo+key%2Fwith%3Fchars');
  assert.equal(iframeUrl.origin, 'https://customer.example');
  assert.equal(iframeUrl.pathname, '/widget.html');
  assert.equal(iframeUrl.searchParams.get('publicKey'), publicKey);
  assert.equal(iframeUrl.searchParams.size, 1);
});
