import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createServer } from 'vite';
import { rmSync } from 'node:fs';

const CACHE_DIR = '/tmp/pcw-r6-vite-test-cache-' + process.pid;
let vite;
let appMod, apiMod, compatMod, localReplyMod;

before(async () => {
  vite = await createServer({
    configFile: new URL('../vite.config.ts', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    cacheDir: CACHE_DIR,
    logLevel: 'silent',
  });
  appMod = await vite.ssrLoadModule('/src/App.tsx');
  apiMod = await vite.ssrLoadModule('/src/console-api.ts');
  compatMod = await vite.ssrLoadModule('/src/compat/widget-settings-legacy-compat.tsx');
  localReplyMod = await vite.ssrLoadModule('/src/local-manual-reply-command.ts');
});

after(async () => {
  if (vite) await vite.close();
  try { rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {}
});

// ═══════════════════════════════════════════════════════════════
// Route parser
// ═══════════════════════════════════════════════════════════════
describe('parseConsoleRoute (real production export)', () => {
  test('/ → sites', () => assert.deepEqual(appMod.parseConsoleRoute('/console'), { page: 'sites' }));
  test('/console/ → sites', () => assert.deepEqual(appMod.parseConsoleRoute('/console/'), { page: 'sites' }));
  test('/console/sites → sites', () => assert.deepEqual(appMod.parseConsoleRoute('/console/sites'), { page: 'sites' }));
  test('/console/sites/new → createSite', () => assert.deepEqual(appMod.parseConsoleRoute('/console/sites/new'), { page: 'createSite' }));
  test('/console/sites/abc → siteDetail', () => assert.deepEqual(appMod.parseConsoleRoute('/console/sites/abc'), { page: 'siteDetail', siteId: 'abc' }));
  test('encoded siteId', () => assert.deepEqual(appMod.parseConsoleRoute('/console/sites/foo%20%2F%20%C5%BE'), { page: 'siteDetail', siteId: 'foo / ž' }));
  test('malformed percent fallback', () => assert.deepEqual(appMod.parseConsoleRoute('/console/sites/%ZZ'), { page: 'siteDetail', siteId: '%ZZ' }));
  test('create widget', () => assert.deepEqual(appMod.parseConsoleRoute('/console/sites/s1/widgets/new'), { page: 'createWidget', siteId: 's1' }));
  test('widget detail', () => assert.deepEqual(appMod.parseConsoleRoute('/console/sites/s1/widgets/w2'), { page: 'widgetDetail', siteId: 's1', widgetId: 'w2' }));
  test('unknown → notFound', () => assert.deepEqual(appMod.parseConsoleRoute('/console/unknown'), { page: 'notFound' }));
  test('/other → notFound', () => assert.deepEqual(appMod.parseConsoleRoute('/other'), { page: 'notFound' }));
});

// ═══════════════════════════════════════════════════════════════
// Site detail page seam
// ═══════════════════════════════════════════════════════════════
describe('loadSiteDetailPageState', () => {
  const siteFix = Object.freeze({ id: 's1', name: 'Test Site', createdAt: '2026-01-01T00:00:00Z' });
  const widgetsFix = Object.freeze([Object.freeze({ id: 'w1', name: 'W', publicKey: 'pk-abc' })]);
  test('ready with identity-preserved fixtures', async () => {
    const calls = [];
    const result = await appMod.loadSiteDetailPageState('s1', {
      getSite: async (id) => { calls.push(['getSite', id]); return siteFix; },
      listWidgets: async (id) => { calls.push(['listWidgets', id]); return widgetsFix; },
    }, () => true);
    assert.deepEqual(calls, [['getSite', 's1'], ['listWidgets', 's1']]);
    assert.equal(result.status, 'ready');
    assert.equal(result.site, siteFix);
    assert.equal(result.widgets, widgetsFix);
  });
  test('404 from getSite → notFound', async () => {
    const r = await appMod.loadSiteDetailPageState('s1', {
      getSite: async () => { throw new apiMod.ApiError(404, ''); },
      listWidgets: async () => [],
    }, () => true);
    assert.deepEqual(r, { status: 'notFound' });
  });
  test('generic error → error', async () => {
    const r = await appMod.loadSiteDetailPageState('s1', {
      getSite: async () => { throw new Error('net'); },
      listWidgets: async () => [],
    }, () => true);
    assert.deepEqual(r, { status: 'error' });
  });
  test('stale success → null', async () => {
    assert.equal(await appMod.loadSiteDetailPageState('s1', { getSite: async () => siteFix, listWidgets: async () => widgetsFix }, () => false), null);
  });
  test('stale error → null', async () => {
    assert.equal(await appMod.loadSiteDetailPageState('s1', { getSite: async () => { throw new apiMod.ApiError(404, ''); }, listWidgets: async () => [] }, () => false), null);
  });
});

// ═══════════════════════════════════════════════════════════════
// Create widget page seam
// ═══════════════════════════════════════════════════════════════
describe('loadCreateWidgetPageState', () => {
  const siteFix = Object.freeze({ id: 's1', name: 'Test', createdAt: '2026-01-01T00:00:00Z' });
  test('ready', async () => { const r = await appMod.loadCreateWidgetPageState('s1', { getSite: async () => siteFix }, () => true); assert.equal(r.status, 'ready'); assert.equal(r.site, siteFix); });
  test('404 → notFound', async () => { assert.deepEqual(await appMod.loadCreateWidgetPageState('s1', { getSite: async () => { throw new apiMod.ApiError(404, ''); } }, () => true), { status: 'notFound' }); });
  test('current generic rejection returns error', async () => { assert.deepEqual(await appMod.loadCreateWidgetPageState('s1', { getSite: async () => { throw new Error('net'); } }, () => true), { status: 'error' }); });
  test('stale generic rejection returns null', async () => { assert.equal(await appMod.loadCreateWidgetPageState('s1', { getSite: async () => { throw new Error('net'); } }, () => false), null); });
  test('stale 404 rejection returns null', async () => { assert.equal(await appMod.loadCreateWidgetPageState('s1', { getSite: async () => { throw new apiMod.ApiError(404, ''); } }, () => false), null); });
  test('stale success returns null', async () => { assert.equal(await appMod.loadCreateWidgetPageState('s1', { getSite: async () => siteFix }, () => false), null); });
});

describe('submitCreateWidgetPage', () => {
  test('success navigates to site detail', async () => {
    const nav = [];
    const r = await appMod.submitCreateWidgetPage('s / ž', 'My Widget', {
      createWidget: async (sid, inp) => { assert.equal(sid, 's / ž'); assert.deepEqual(inp, { name: 'My Widget' }); },
    }, (p) => nav.push(p));
    assert.equal(r, 'created'); assert.deepEqual(nav, ['/console/sites/s / ž']);
  });
  test('404 returns notFound, no navigation', async () => { const nav = []; const r = await appMod.submitCreateWidgetPage('s1', 'W', { createWidget: async () => { throw new apiMod.ApiError(404, ''); } }, (p) => nav.push(p)); assert.equal(r, 'notFound'); assert.deepEqual(nav, []); });
  test('generic error returns error, no navigation', async () => { const nav = []; const r = await appMod.submitCreateWidgetPage('s1', 'W', { createWidget: async () => { throw new Error('fail'); } }, (p) => nav.push(p)); assert.equal(r, 'error'); assert.deepEqual(nav, []); });
});

// ═══════════════════════════════════════════════════════════════
// ConsoleRouteView: exact key and all props across three tuples
// ═══════════════════════════════════════════════════════════════
describe('ConsoleRouteView: exact compatibility key and props across two-dimensional tuples', () => {
  const callback = () => {};
  test('widget-detail produces exact key and props', () => {
    const el1 = appMod.ConsoleRouteView({ route: { page: 'widgetDetail', siteId: 'site-a', widgetId: 'widget-shared' }, onNavigate: callback });
    const el2 = appMod.ConsoleRouteView({ route: { page: 'widgetDetail', siteId: 'site-b', widgetId: 'widget-shared' }, onNavigate: callback });
    const el3 = appMod.ConsoleRouteView({ route: { page: 'widgetDetail', siteId: 'site-a', widgetId: 'widget-other' }, onNavigate: callback });
    assert.equal(el1.key, JSON.stringify(['site-a', 'widget-shared']));
    assert.equal(el2.key, JSON.stringify(['site-b', 'widget-shared']));
    assert.equal(el3.key, JSON.stringify(['site-a', 'widget-other']));
    assert.notEqual(el1.key, el2.key); assert.notEqual(el1.key, el3.key); assert.notEqual(el2.key, el3.key);
    // All props on all tuples
    assert.equal(el1.props.siteId, 'site-a'); assert.equal(el1.props.widgetId, 'widget-shared'); assert.equal(el1.props.onNavigate, callback);
    assert.equal(el2.props.siteId, 'site-b'); assert.equal(el2.props.widgetId, 'widget-shared'); assert.equal(el2.props.onNavigate, callback);
    assert.equal(el3.props.siteId, 'site-a'); assert.equal(el3.props.widgetId, 'widget-other'); assert.equal(el3.props.onNavigate, callback);
  });
});

// ═══════════════════════════════════════════════════════════════
// Stale-copy scope with real constructor/reducer (dirty via copyStarted+ID)
// ═══════════════════════════════════════════════════════════════
describe('localManualReplyStateForScope with real fixtures', () => {
  function makeDirtySuccessState(scope) {
    let s = localReplyMod.createLocalManualReplyState(scope);
    s = localReplyMod.reduceLocalManualReplyState(s, { type: 'draftChanged', draft: 'dirty' });
    s = localReplyMod.reduceLocalManualReplyState(s, { type: 'copyStarted', requestId: 41, command: s.command });
    s = localReplyMod.reduceLocalManualReplyState(s, { type: 'copySucceeded', requestId: 41, command: s.command });
    return s;
  }
  function makeDirtyFailureState(scope) {
    let s = localReplyMod.createLocalManualReplyState(scope);
    s = localReplyMod.reduceLocalManualReplyState(s, { type: 'draftChanged', draft: 'fail-dirty' });
    s = localReplyMod.reduceLocalManualReplyState(s, { type: 'copyStarted', requestId: 42, command: s.command });
    s = localReplyMod.reduceLocalManualReplyState(s, { type: 'copyFailed', requestId: 42, command: s.command });
    return s;
  }
  test('same scope preserves identity', () => {
    const scope = { siteId: 's1', widgetId: 'w1', candidateId: 'c1' };
    const dirty = makeDirtySuccessState(scope);
    assert.equal(compatMod.localManualReplyStateForScope(dirty, scope), dirty);
  });
  test('site change returns exact real defaults', () => {
    const dirty = makeDirtySuccessState({ siteId: 's1', widgetId: 'w1', candidateId: 'c1' });
    assert.ok(dirty.copiedCommand !== null, 'precondition: dirty has copiedCommand');
    assert.ok(dirty.latestCopyRequestId !== null, 'precondition: dirty has latestCopyRequestId');
    const newScope = { siteId: 's2', widgetId: 'w1', candidateId: 'c1' };
    const result = compatMod.localManualReplyStateForScope(dirty, newScope);
    assert.notEqual(result, dirty);
    assert.deepEqual(result, localReplyMod.createLocalManualReplyState(newScope));
    assert.equal(result.copiedCommand, null); assert.equal(result.copyErrorCommand, null);
  });
  test('widget change returns exact real defaults', () => {
    const dirty = makeDirtyFailureState({ siteId: 's1', widgetId: 'w1', candidateId: 'c1' });
    assert.ok(dirty.copyErrorCommand !== null, 'precondition: dirty has copyErrorCommand');
    const newScope = { siteId: 's1', widgetId: 'w2', candidateId: 'c1' };
    const result = compatMod.localManualReplyStateForScope(dirty, newScope);
    assert.notEqual(result, dirty);
    assert.deepEqual(result, localReplyMod.createLocalManualReplyState(newScope));
  });
  test('candidate change returns exact real defaults', () => {
    const dirty = makeDirtySuccessState({ siteId: 's1', widgetId: 'w1', candidateId: 'c1' });
    const newScope = { siteId: 's1', widgetId: 'w1', candidateId: 'c2' };
    const result = compatMod.localManualReplyStateForScope(dirty, newScope);
    assert.notEqual(result, dirty);
    const expected = localReplyMod.createLocalManualReplyState(newScope);
    assert.deepEqual(result, expected);
    assert.equal(result.draft, localReplyMod.DEFAULT_LOCAL_MANUAL_REPLY_TEXT);
    assert.equal(result.copiedCommand, null); assert.equal(result.copyErrorCommand, null);
    assert.equal(result.latestCopyRequestId, null);
  });
});

// ═══════════════════════════════════════════════════════════════
// Subscribe/copy wiring
// ═══════════════════════════════════════════════════════════════
describe('subscribeLocalManualReplyCopy: exact coordinator callback and returned unsubscribe', () => {
  test('passes exact dispatch, returns exact unsubscribe, invokes unsubscribe', () => {
    let unsubCalls = 0;
    const subscribeCalls = [];
    const sentinelUnsub = () => { unsubCalls++; };
    const fakeCoordinator = { subscribe(d) { subscribeCalls.push(d); return sentinelUnsub; } };
    const dispatch = () => {};
    const unsub = compatMod.subscribeLocalManualReplyCopy(dispatch, fakeCoordinator);
    assert.equal(subscribeCalls.length, 1);
    assert.equal(subscribeCalls[0], dispatch);
    assert.equal(unsub, sentinelUnsub);
    unsub();
    assert.equal(unsubCalls, 1);
  });
});

describe('copyLocalManualReplyCommand: exact command/getter call and returned Promise<boolean>', () => {
  test('calls coordinator.copy once with exact args and returns its promise', async () => {
    const copyCalls = [];
    let getterCount = 0;
    const sentinelClipboard = {};
    const sentinelPromise = Promise.resolve(true);
    const fakeCoordinator = {
      copy(cmd, getter) {
        copyCalls.push({ cmd, getter });
        const cb = getter();
        assert.equal(cb, sentinelClipboard);
        return sentinelPromise;
      },
    };
    const getClipboard = () => { getterCount++; return sentinelClipboard; };
    const result = compatMod.copyLocalManualReplyCommand('test-cmd', getClipboard, fakeCoordinator);
    assert.equal(result, sentinelPromise, 'must return exact coordinator promise');
    assert.equal(copyCalls.length, 1, 'coordinator.copy called exactly once');
    assert.equal(copyCalls[0].cmd, 'test-cmd');
    assert.equal(copyCalls[0].getter, getClipboard, 'getter identity forwarded');
    assert.equal(getterCount, 1, 'getClipboard invoked exactly once');
    const resolved = await result;
    assert.equal(resolved, true);
  });
});

// ═══════════════════════════════════════════════════════════════
// API request table with special-character IDs, exact sentinels,
// per-function 404, bodylessness, and global traps
// ═══════════════════════════════════════════════════════════════
describe('console-api request contracts via fake fetch', { concurrency: false }, () => {
  // Save originals
  const savedFetchDesc = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const savedLSDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const savedSSDesc = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const hadDocument = 'document' in globalThis;
  const savedDocDesc = hadDocument ? Object.getOwnPropertyDescriptor(globalThis, 'document') : undefined;
  const savedCookieDesc = hadDocument && globalThis.document ? Object.getOwnPropertyDescriptor(globalThis.document, 'cookie') : undefined;

  function installTraps() {
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('localStorage accessed'); }, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { get() { throw new Error('sessionStorage accessed'); }, configurable: true });
    // Ensure document exists with a throwing cookie
    if (!('document' in globalThis)) {
      Object.defineProperty(globalThis, 'document', { value: {}, writable: true, configurable: true });
    }
    Object.defineProperty(globalThis.document, 'cookie', {
      get() { throw new Error('document.cookie accessed'); },
      set() { throw new Error('document.cookie written'); },
      configurable: true,
    });
  }

  function restoreTraps() {
    // Restore localStorage
    if (savedLSDesc) Object.defineProperty(globalThis, 'localStorage', savedLSDesc);
    else delete globalThis.localStorage;
    // Restore sessionStorage
    if (savedSSDesc) Object.defineProperty(globalThis, 'sessionStorage', savedSSDesc);
    else delete globalThis.sessionStorage;
    // Restore document/cookie
    if (hadDocument) {
      if (savedDocDesc) Object.defineProperty(globalThis, 'document', savedDocDesc);
      if (globalThis.document && savedCookieDesc) Object.defineProperty(globalThis.document, 'cookie', savedCookieDesc);
      else if (globalThis.document) delete globalThis.document.cookie;
    } else {
      delete globalThis.document;
    }
  }

  after(() => {
    if (savedFetchDesc) Object.defineProperty(globalThis, 'fetch', savedFetchDesc);
    restoreTraps();
  });

  function installFakeFetch(responseBody, status = 200) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body, credentials: init.credentials });
      return new Response(status === 204 ? null : JSON.stringify(responseBody), { status, headers: { 'content-type': 'application/json' } });
    };
    return calls;
  }

  function installIdentityFakeFetch(responseBody, status = 200) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body, credentials: init.credentials });
      const response = new Response(status === 204 ? null : JSON.stringify(responseBody), { status, headers: { 'content-type': 'application/json' } });
      if (status !== 204) Object.defineProperty(response, 'json', { value: async () => responseBody });
      return response;
    };
    return calls;
  }

  // Sentinel objects for exact identity checks
  const SITE_SENTINEL = Object.freeze({ id: 'site-sentinel', name: 'Site / ž', createdAt: '2026-01-01T00:00:00Z' });
  const WIDGET_SENTINEL = Object.freeze({ id: 'widget-sentinel', name: 'Widget / 漢', publicKey: 'pk-漢' });
  const DOMAIN_SENTINEL = Object.freeze({ id: 'domain-sentinel', domain: 'example.com', createdAt: '2026-01-01T00:00:00Z' });
  const CONTEXT_SENTINEL = Object.freeze({ user: Object.freeze({ email: 'a@b.c' }), workspace: Object.freeze({ name: 'W / ž' }) });
  const SETTINGS_SENTINEL = Object.freeze({ widget: {}, config: {}, install: {}, connection: {} });

  const SETUP_STATUS_RESPONSE = Object.freeze({ setupRequired: false });
  const SITE_LIST_RESPONSE = Object.freeze({ sites: Object.freeze([SITE_SENTINEL]) });
  const SITE_RESPONSE = Object.freeze({ site: SITE_SENTINEL });
  const WIDGET_LIST_RESPONSE = Object.freeze({ widgets: Object.freeze([WIDGET_SENTINEL]) });
  const WIDGET_RESPONSE = Object.freeze({ widget: WIDGET_SENTINEL });
  const DOMAIN_LIST_RESPONSE = Object.freeze({ domains: Object.freeze([DOMAIN_SENTINEL]) });
  const DOMAIN_RESPONSE = Object.freeze({ domain: DOMAIN_SENTINEL });

  const table = [
    { fn: 'getSetupStatus', args: [], method: 'GET', path: '/api/auth/setup-status', response: SETUP_STATUS_RESPONSE, expectedIdentity: SETUP_STATUS_RESPONSE, exactResult: (r) => { assert.equal(r.setupRequired, false); } },
    { fn: 'getCurrentContext', args: [], method: 'GET', path: '/api/me', response: CONTEXT_SENTINEL, expectedIdentity: CONTEXT_SENTINEL, exactResult: (r) => { assert.deepEqual(r, CONTEXT_SENTINEL); } },
    { fn: 'setupFirstOwner', args: [{ email: 'a@b.c', password: 'x', workspaceName: 'W' }], method: 'POST', path: '/api/auth/setup', hasBody: true, expectedBody: { email: 'a@b.c', password: 'x', workspaceName: 'W' }, response: CONTEXT_SENTINEL, expectedIdentity: CONTEXT_SENTINEL, exactResult: (r) => { assert.deepEqual(r, CONTEXT_SENTINEL); } },
    { fn: 'login', args: [{ email: 'a@b.c', password: 'x' }], method: 'POST', path: '/api/auth/login', hasBody: true, expectedBody: { email: 'a@b.c', password: 'x' }, response: CONTEXT_SENTINEL, expectedIdentity: CONTEXT_SENTINEL, exactResult: (r) => { assert.deepEqual(r, CONTEXT_SENTINEL); } },
    { fn: 'logout', args: [], method: 'POST', path: '/api/auth/logout', status: 204, expectedIdentity: undefined, exactResult: (r) => { assert.equal(r, undefined); } },
    { fn: 'listSites', args: [], method: 'GET', path: '/api/console/sites', response: SITE_LIST_RESPONSE, expectedIdentity: SITE_LIST_RESPONSE.sites, exactResult: (r) => { assert.deepEqual(r[0], SITE_SENTINEL); assert.equal(r.length, 1); } },
    { fn: 'getSite', args: ['site / ž'], method: 'GET', path: '/api/console/sites/site%20%2F%20%C5%BE', response: SITE_RESPONSE, expectedIdentity: SITE_SENTINEL, exactResult: (r) => { assert.deepEqual(r, SITE_SENTINEL); assert.equal(r.id, 'site-sentinel'); } },
    { fn: 'createSite', args: [{ name: 'S' }], method: 'POST', path: '/api/console/sites', hasBody: true, expectedBody: { name: 'S' }, response: SITE_RESPONSE, expectedIdentity: SITE_SENTINEL, exactResult: (r) => { assert.deepEqual(r, SITE_SENTINEL); assert.equal(r.id, 'site-sentinel'); } },
    { fn: 'listWidgets', args: ['site / ž'], method: 'GET', path: '/api/console/sites/site%20%2F%20%C5%BE/widgets', response: WIDGET_LIST_RESPONSE, expectedIdentity: WIDGET_LIST_RESPONSE.widgets, exactResult: (r) => { assert.deepEqual(r[0], WIDGET_SENTINEL); assert.equal(r.length, 1); } },
    { fn: 'createWidget', args: ['site / ž', { name: 'W' }], method: 'POST', path: '/api/console/sites/site%20%2F%20%C5%BE/widgets', hasBody: true, expectedBody: { name: 'W' }, response: WIDGET_RESPONSE, expectedIdentity: WIDGET_SENTINEL, exactResult: (r) => { assert.deepEqual(r, WIDGET_SENTINEL); assert.equal(r.id, 'widget-sentinel'); } },
    { fn: 'getWidgetSettings', args: ['site / ž', 'widget / 漢'], method: 'GET', path: '/api/console/sites/site%20%2F%20%C5%BE/widgets/widget%20%2F%20%E6%BC%A2/settings', response: SETTINGS_SENTINEL, expectedIdentity: SETTINGS_SENTINEL, exactResult: (r) => { assert.deepEqual(r, SETTINGS_SENTINEL); } },
    { fn: 'updateWidgetSettings', args: ['site / ž', 'widget / 漢', { name: 'N' }], method: 'PATCH', path: '/api/console/sites/site%20%2F%20%C5%BE/widgets/widget%20%2F%20%E6%BC%A2/settings', hasBody: true, expectedBody: { name: 'N' }, response: SETTINGS_SENTINEL, expectedIdentity: SETTINGS_SENTINEL, exactResult: (r) => { assert.deepEqual(r, SETTINGS_SENTINEL); } },
    { fn: 'listWidgetDomains', args: ['site / ž', 'widget / 漢'], method: 'GET', path: '/api/console/sites/site%20%2F%20%C5%BE/widgets/widget%20%2F%20%E6%BC%A2/domains', response: DOMAIN_LIST_RESPONSE, expectedIdentity: DOMAIN_LIST_RESPONSE.domains, exactResult: (r) => { assert.deepEqual(r[0], DOMAIN_SENTINEL); assert.equal(r.length, 1); } },
    { fn: 'createWidgetDomain', args: ['site / ž', 'widget / 漢', { domain: 'x.com' }], method: 'POST', path: '/api/console/sites/site%20%2F%20%C5%BE/widgets/widget%20%2F%20%E6%BC%A2/domains', hasBody: true, expectedBody: { domain: 'x.com' }, response: DOMAIN_RESPONSE, expectedIdentity: DOMAIN_SENTINEL, exactResult: (r) => { assert.deepEqual(r, DOMAIN_SENTINEL); assert.equal(r.id, 'domain-sentinel'); } },
    { fn: 'deleteWidgetDomain', args: ['site / ž', 'widget / 漢', 'domain / ü'], method: 'DELETE', path: '/api/console/sites/site%20%2F%20%C5%BE/widgets/widget%20%2F%20%E6%BC%A2/domains/domain%20%2F%20%C3%BC', status: 204, expectedIdentity: undefined, exactResult: (r) => { assert.equal(r, undefined); } },
  ];

  for (const { fn, args, method, path, hasBody, expectedBody, status, response, expectedIdentity, exactResult } of table) {
    test(`console-api ${fn}: exact request, result, 404, and browser-state isolation`, async () => {
      installTraps();
      try {
        // Success
        const calls = installFakeFetch(response ?? {}, status ?? 200);
        const result = await apiMod[fn](...args);
        assert.equal(calls.length, 1, `${fn}: exactly 1 fetch`);
        assert.equal(calls[0].url, path);
        assert.equal(calls[0].method, method);
        assert.equal(calls[0].credentials, 'include');
        assert.equal(calls[0].headers.accept, 'application/json');
        assert.ok(!calls[0].headers.Authorization);
        if (method === 'GET') { assert.ok(!calls[0].headers['x-panda-csrf']); }
        else { assert.equal(calls[0].headers['x-panda-csrf'], '1'); }
        if (hasBody) {
          assert.equal(calls[0].headers['content-type'], 'application/json');
          assert.deepEqual(JSON.parse(calls[0].body), expectedBody);
        } else {
          assert.equal(calls[0].body, undefined, `${fn}: no body`);
          assert.equal(calls[0].headers['content-type'], undefined, `${fn}: no content-type`);
        }
        exactResult(result);
        // 404
        const calls404 = installFakeFetch({}, 404);
        await assert.rejects(() => apiMod[fn](...args), (err) => {
          assert.ok(err instanceof apiMod.ApiError); assert.equal(err.status, 404); return true;
        });
        assert.equal(calls404.length, 1, `${fn} 404: exactly 1 fetch`);
        // Identity-only control: still a native Response, with only instance json() shadowed.
        const identityCalls = installIdentityFakeFetch(response ?? {}, status ?? 200);
        const identityResult = await apiMod[fn](...args);
        assert.equal(identityCalls.length, 1, `${fn} identity: exactly 1 fetch`);
        assert.equal(identityResult, expectedIdentity, `${fn}: exact result identity`);
      } finally { restoreTraps(); }
    });
  }

  test('console-api globals: fetch/localStorage/sessionStorage/document descriptors are restored', () => {
    installTraps();
    restoreTraps();
    // localStorage and sessionStorage must be back to original
    const curLS = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const curSS = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    if (savedLSDesc) { assert.equal(typeof curLS, 'object'); }
    else { assert.equal(curLS, undefined); }
    if (savedSSDesc) { assert.equal(typeof curSS, 'object'); }
    else { assert.equal(curSS, undefined); }
    // document must match original presence
    if (!hadDocument) { assert.ok(!('document' in globalThis), 'document must be absent if originally absent'); }
  });
});

// ═══════════════════════════════════════════════════════════════
// Compat: DTO fields, candidate details, diagnostics
// ═══════════════════════════════════════════════════════════════
describe('NEXT_LOCAL_REPLY_CANDIDATE_FIELDS exact tuple', () => {
  test('exactly 7 frozen fields in order', () => {
    assert.deepEqual([...compatMod.NEXT_LOCAL_REPLY_CANDIDATE_FIELDS], ['id', 'status', 'conversationId', 'visitorMessageId', 'clientMessageId', 'createdAt', 'claimedAt']);
  });
});

describe('nextLocalReplyCandidateDetails via throwing Proxy', () => {
  test('accesses only the 7 allowed fields', () => {
    const candidate = new Proxy(Object.create(null), {
      ownKeys() { throw new Error('ownKeys called'); },
      get(_, key) {
        if (typeof key === 'symbol' || key === 'then') return undefined;
        if (!['id','status','conversationId','visitorMessageId','clientMessageId','createdAt','claimedAt'].includes(key)) throw new Error(`Unexpected: ${String(key)}`);
        return key === 'claimedAt' ? null : `val-${String(key)}`;
      },
    });
    const details = compatMod.nextLocalReplyCandidateDetails(candidate);
    assert.equal(details.length, 6);
    assert.deepEqual(details.map(d => d.label), ['status','conversationId','visitorMessageId','clientMessageId','createdAt','claimedAt']);
    assert.equal(details[5].value, 'not claimed yet');
  });
});

describe('loadLocalDiagnostics', () => {
  test('ready with candidateChanged detection', async () => {
    const localDelivery = Object.freeze({ nextLocalReplyCandidate: { id: 'new-c' }, queuedIntentCount: 0, claimedIntentCount: 0, appliedLocalReplyCount: 0, lastQueuedAt: null, lastClaimedAt: null, lastAppliedLocalReplyAt: null });
    const response = new Proxy(Object.create(null), {
      get(_, key) {
        if (typeof key === 'symbol' || key === 'then') return undefined;
        if (key === 'connection') return new Proxy(Object.create(null), {
          get(_, ck) {
            if (typeof ck === 'symbol' || ck === 'then') return undefined;
            if (ck === 'localDelivery') return localDelivery;
            throw new Error(`forbidden: connection.${String(ck)}`);
          },
        });
        throw new Error(`forbidden: ${String(key)}`);
      },
    });
    const calls = [];
    const r = await compatMod.loadLocalDiagnostics('s1', 'w1', 'old-c', { getWidgetSettings: async (s, w) => { calls.push([s,w]); return response; }, isCurrent: () => true });
    assert.deepEqual(calls, [['s1','w1']]); assert.equal(r.status, 'ready'); assert.equal(r.localDelivery, localDelivery); assert.equal(r.candidateChanged, true);
  });
  test('candidateChanged false', async () => {
    const ld = { nextLocalReplyCandidate: { id: 'same' }, queuedIntentCount: 0, claimedIntentCount: 0, appliedLocalReplyCount: 0, lastQueuedAt: null, lastClaimedAt: null, lastAppliedLocalReplyAt: null };
    const r = await compatMod.loadLocalDiagnostics('s1', 'w1', 'same', { getWidgetSettings: async () => ({ connection: { localDelivery: ld } }), isCurrent: () => true });
    assert.equal(r.candidateChanged, false);
  });
  test('stale success', async () => { assert.deepEqual(await compatMod.loadLocalDiagnostics('s1','w1',null,{ getWidgetSettings: async () => ({ connection: { localDelivery: { nextLocalReplyCandidate: null } } }), isCurrent: () => false }), { status: 'stale' }); });
  test('stale error', async () => { assert.deepEqual(await compatMod.loadLocalDiagnostics('s1','w1',null,{ getWidgetSettings: async () => { throw new Error('net'); }, isCurrent: () => false }), { status: 'stale' }); });
  test('generic error when current', async () => { assert.deepEqual(await compatMod.loadLocalDiagnostics('s1','w1',null,{ getWidgetSettings: async () => { throw new Error('net'); }, isCurrent: () => true }), { status: 'error' }); });
});

describe('mergeLocalDiagnostics preserves unrelated identities', () => {
  test('merges only localDelivery, preserves all else', () => {
    const domains = [{ id: 'd1', domain: 'x.com', createdAt: '2026-01-01T00:00:00Z' }];
    const sw = Object.freeze({ name: 'W', publicKey: 'pk' });
    const sc = Object.freeze({ assistant: { displayName: 'A' }, launcher: { label: 'L', icon: 'message' }, welcome: { title: 'T', subtitle: 'S' }, theme: { colorMode: 'light', accent: 'blue', radius: 'md' } });
    const si = Object.freeze({ snippetAvailable: true, snippet: '<script>' });
    const od = Object.freeze({ nextLocalReplyCandidate: null, queuedIntentCount: 0, claimedIntentCount: 0, appliedLocalReplyCount: 0, lastQueuedAt: null, lastClaimedAt: null, lastAppliedLocalReplyAt: null });
    const state = { status: 'ready', settings: { widget: sw, config: sc, install: si, connection: { status: 'configured_placeholder', routeHandle: 'r', localDelivery: od } }, domains };
    const nd = Object.freeze({ nextLocalReplyCandidate: { id: 'new' }, queuedIntentCount: 1, claimedIntentCount: 0, appliedLocalReplyCount: 0, lastQueuedAt: null, lastClaimedAt: null, lastAppliedLocalReplyAt: null });
    const m = compatMod.mergeLocalDiagnostics(state, nd);
    assert.equal(m.settings.widget, sw); assert.equal(m.settings.config, sc); assert.equal(m.settings.install, si);
    assert.equal(m.settings.connection.status, 'configured_placeholder'); assert.equal(m.settings.connection.routeHandle, 'r');
    assert.equal(m.settings.connection.localDelivery, nd); assert.equal(m.domains, domains);
  });
  test('non-ready unchanged', () => { const s = { status: 'loading' }; assert.equal(compatMod.mergeLocalDiagnostics(s, {}), s); });
});
