import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createServer } from 'vite';
import { rmSync } from 'node:fs';

const CACHE_DIR = '/tmp/pcw-r5-vite-test-cache-' + process.pid;
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
// Route parser (real production export)
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
    const result = await appMod.loadSiteDetailPageState('s1', {
      getSite: async () => { throw new apiMod.ApiError(404, 'not found'); },
      listWidgets: async () => [],
    }, () => true);
    assert.deepEqual(result, { status: 'notFound' });
  });

  test('generic error → error', async () => {
    const result = await appMod.loadSiteDetailPageState('s1', {
      getSite: async () => { throw new Error('network'); },
      listWidgets: async () => [],
    }, () => true);
    assert.deepEqual(result, { status: 'error' });
  });

  test('stale success → null', async () => {
    const result = await appMod.loadSiteDetailPageState('s1', {
      getSite: async () => siteFix,
      listWidgets: async () => widgetsFix,
    }, () => false);
    assert.equal(result, null);
  });

  test('stale error → null', async () => {
    const result = await appMod.loadSiteDetailPageState('s1', {
      getSite: async () => { throw new apiMod.ApiError(404, ''); },
      listWidgets: async () => [],
    }, () => false);
    assert.equal(result, null);
  });
});

// ═══════════════════════════════════════════════════════════════
// Create widget page seam
// ═══════════════════════════════════════════════════════════════

describe('loadCreateWidgetPageState', () => {
  const siteFix = Object.freeze({ id: 's1', name: 'Test', createdAt: '2026-01-01T00:00:00Z' });

  test('ready', async () => {
    const result = await appMod.loadCreateWidgetPageState('s1', { getSite: async () => siteFix }, () => true);
    assert.equal(result.status, 'ready');
    assert.equal(result.site, siteFix);
  });

  test('404 → notFound', async () => {
    const result = await appMod.loadCreateWidgetPageState('s1', {
      getSite: async () => { throw new apiMod.ApiError(404, ''); },
    }, () => true);
    assert.deepEqual(result, { status: 'notFound' });
  });

  test('current generic rejection returns error', async () => {
    const result = await appMod.loadCreateWidgetPageState('s1', {
      getSite: async () => { throw new Error('network'); },
    }, () => true);
    assert.deepEqual(result, { status: 'error' });
  });

  test('stale generic rejection returns null', async () => {
    const result = await appMod.loadCreateWidgetPageState('s1', {
      getSite: async () => { throw new Error('net'); },
    }, () => false);
    assert.equal(result, null);
  });

  test('stale 404 rejection returns null', async () => {
    const result = await appMod.loadCreateWidgetPageState('s1', {
      getSite: async () => { throw new apiMod.ApiError(404, ''); },
    }, () => false);
    assert.equal(result, null);
  });

  test('stale success returns null', async () => {
    const result = await appMod.loadCreateWidgetPageState('s1', { getSite: async () => siteFix }, () => false);
    assert.equal(result, null);
  });
});

describe('submitCreateWidgetPage', () => {
  test('success navigates to site detail', async () => {
    const nav = [];
    const result = await appMod.submitCreateWidgetPage('s / ž', 'My Widget', {
      createWidget: async (siteId, input) => {
        assert.equal(siteId, 's / ž');
        assert.deepEqual(input, { name: 'My Widget' });
      },
    }, (p) => nav.push(p));
    assert.equal(result, 'created');
    assert.deepEqual(nav, ['/console/sites/s / ž']);
  });

  test('404 returns notFound, no navigation', async () => {
    const nav = [];
    const result = await appMod.submitCreateWidgetPage('s1', 'W', {
      createWidget: async () => { throw new apiMod.ApiError(404, ''); },
    }, (p) => nav.push(p));
    assert.equal(result, 'notFound');
    assert.deepEqual(nav, []);
  });

  test('generic error returns error, no navigation', async () => {
    const nav = [];
    const result = await appMod.submitCreateWidgetPage('s1', 'W', {
      createWidget: async () => { throw new Error('fail'); },
    }, (p) => nav.push(p));
    assert.equal(result, 'error');
    assert.deepEqual(nav, []);
  });
});

// ═══════════════════════════════════════════════════════════════
// ConsoleRouteView: exact compatibility key and props
// ═══════════════════════════════════════════════════════════════

describe('ConsoleRouteView: exact compatibility key and props across two-dimensional tuples', () => {
  const callback = () => {};
  test('widget-detail produces exact key and props', () => {
    const el1 = appMod.ConsoleRouteView({ route: { page: 'widgetDetail', siteId: 'site-a', widgetId: 'widget-shared' }, onNavigate: callback });
    const el2 = appMod.ConsoleRouteView({ route: { page: 'widgetDetail', siteId: 'site-b', widgetId: 'widget-shared' }, onNavigate: callback });
    const el3 = appMod.ConsoleRouteView({ route: { page: 'widgetDetail', siteId: 'site-a', widgetId: 'widget-other' }, onNavigate: callback });
    // Exact key = JSON.stringify([siteId, widgetId])
    assert.equal(el1.key, JSON.stringify(['site-a', 'widget-shared']));
    assert.equal(el2.key, JSON.stringify(['site-b', 'widget-shared']));
    assert.equal(el3.key, JSON.stringify(['site-a', 'widget-other']));
    // Keys differ when either dimension differs
    assert.notEqual(el1.key, el2.key);
    assert.notEqual(el1.key, el3.key);
    assert.notEqual(el2.key, el3.key);
    // Exact props
    assert.equal(el1.props.siteId, 'site-a');
    assert.equal(el1.props.widgetId, 'widget-shared');
    assert.equal(el1.props.onNavigate, callback);
    assert.equal(el2.props.siteId, 'site-b');
    assert.equal(el3.props.widgetId, 'widget-other');
  });
});

// ═══════════════════════════════════════════════════════════════
// Stale-copy scope with real constructor/reducer
// ═══════════════════════════════════════════════════════════════

describe('localManualReplyStateForScope with real fixtures', () => {
  function makeDirtySuccessState(scope) {
    let state = localReplyMod.createLocalManualReplyState(scope);
    state = localReplyMod.reduceLocalManualReplyState(state, { type: 'draftChanged', draft: 'dirty draft' });
    state = localReplyMod.reduceLocalManualReplyState(state, { type: 'copySucceeded', command: state.command });
    return state;
  }

  function makeDirtyFailureState(scope) {
    let state = localReplyMod.createLocalManualReplyState(scope);
    state = localReplyMod.reduceLocalManualReplyState(state, { type: 'draftChanged', draft: 'failed draft' });
    state = localReplyMod.reduceLocalManualReplyState(state, { type: 'copyFailed', command: state.command });
    return state;
  }

  test('same scope preserves identity', () => {
    const scope = { siteId: 's1', widgetId: 'w1', candidateId: 'c1' };
    const dirty = makeDirtySuccessState(scope);
    assert.equal(compatMod.localManualReplyStateForScope(dirty, scope), dirty);
  });

  test('site change returns exact real defaults', () => {
    const oldScope = { siteId: 's1', widgetId: 'w1', candidateId: 'c1' };
    const newScope = { siteId: 's2', widgetId: 'w1', candidateId: 'c1' };
    const dirty = makeDirtySuccessState(oldScope);
    const result = compatMod.localManualReplyStateForScope(dirty, newScope);
    assert.notEqual(result, dirty);
    const expected = localReplyMod.createLocalManualReplyState(newScope);
    assert.deepEqual(result, expected);
  });

  test('widget change returns exact real defaults', () => {
    const oldScope = { siteId: 's1', widgetId: 'w1', candidateId: 'c1' };
    const newScope = { siteId: 's1', widgetId: 'w2', candidateId: 'c1' };
    const dirty = makeDirtyFailureState(oldScope);
    const result = compatMod.localManualReplyStateForScope(dirty, newScope);
    assert.notEqual(result, dirty);
    const expected = localReplyMod.createLocalManualReplyState(newScope);
    assert.deepEqual(result, expected);
  });

  test('candidate change returns exact real defaults', () => {
    const oldScope = { siteId: 's1', widgetId: 'w1', candidateId: 'c1' };
    const newScope = { siteId: 's1', widgetId: 'w1', candidateId: 'c2' };
    const dirty = makeDirtySuccessState(oldScope);
    const result = compatMod.localManualReplyStateForScope(dirty, newScope);
    assert.notEqual(result, dirty);
    const expected = localReplyMod.createLocalManualReplyState(newScope);
    assert.deepEqual(result, expected);
    assert.equal(result.draft, localReplyMod.DEFAULT_LOCAL_MANUAL_REPLY_TEXT);
    assert.equal(result.copiedCommand, null);
    assert.equal(result.copyErrorCommand, null);
  });
});

// ═══════════════════════════════════════════════════════════════
// Subscribe/copy wiring seams
// ═══════════════════════════════════════════════════════════════

describe('subscribeLocalManualReplyCopy: exact coordinator callback and returned unsubscribe', () => {
  test('passes exact dispatch and returns exact unsubscribe', () => {
    const subscribeCalls = [];
    const sentinelUnsub = () => {};
    const fakeCoordinator = {
      subscribe(dispatch) { subscribeCalls.push(dispatch); return sentinelUnsub; },
    };
    const dispatch = () => {};
    const unsub = compatMod.subscribeLocalManualReplyCopy(dispatch, fakeCoordinator);
    assert.equal(subscribeCalls.length, 1);
    assert.equal(subscribeCalls[0], dispatch);
    assert.equal(unsub, sentinelUnsub);
  });
});

describe('copyLocalManualReplyCommand: exact command/getter call and returned Promise<boolean>', () => {
  test('calls coordinator.copy once with exact args and returns its promise', async () => {
    const copyCalls = [];
    const sentinelClipboard = {};
    const sentinelPromise = Promise.resolve(true);
    const fakeCoordinator = {
      copy(cmd, getter) {
        copyCalls.push({ cmd, getter });
        const cb = getter();
        assert.equal(cb, sentinelClipboard, 'getter must return sentinel clipboard');
        return sentinelPromise;
      },
    };
    const getClipboard = () => sentinelClipboard;
    const result = compatMod.copyLocalManualReplyCommand('test-cmd', getClipboard, fakeCoordinator);
    assert.equal(result, sentinelPromise, 'must return exact coordinator promise');
    assert.equal(copyCalls.length, 1);
    assert.equal(copyCalls[0].cmd, 'test-cmd');
    assert.equal(copyCalls[0].getter, getClipboard);
    const resolved = await result;
    assert.equal(resolved, true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Real console-api.ts request table via fake fetch
// ═══════════════════════════════════════════════════════════════

describe('console-api request contracts via fake fetch', { concurrency: false }, () => {
  const savedFetch = globalThis.fetch;
  const savedLS = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const savedSS = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const savedCookie = Object.getOwnPropertyDescriptor(globalThis.document ?? {}, 'cookie');

  function installTraps() {
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('localStorage accessed'); }, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { get() { throw new Error('sessionStorage accessed'); }, configurable: true });
    if (typeof document !== 'undefined') {
      Object.defineProperty(document, 'cookie', { get() { throw new Error('document.cookie accessed'); }, set() { throw new Error('document.cookie written'); }, configurable: true });
    }
  }

  function restoreTraps() {
    if (savedLS) Object.defineProperty(globalThis, 'localStorage', savedLS);
    else delete globalThis.localStorage;
    if (savedSS) Object.defineProperty(globalThis, 'sessionStorage', savedSS);
    else delete globalThis.sessionStorage;
    if (typeof document !== 'undefined' && savedCookie) Object.defineProperty(document, 'cookie', savedCookie);
  }

  after(() => {
    globalThis.fetch = savedFetch;
    restoreTraps();
  });

  function installFakeFetch(responseBody, status = 200) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body, credentials: init.credentials });
      return new Response(status === 204 ? null : JSON.stringify(responseBody), {
        status, headers: { 'content-type': 'application/json' },
      });
    };
    return calls;
  }

  const table = [
    { fn: 'getSetupStatus', args: [], method: 'GET', path: '/api/auth/setup-status', response: { setupRequired: false }, unwrap: (r) => r.setupRequired },
    { fn: 'getCurrentContext', args: [], method: 'GET', path: '/api/me', response: { user: { email: 'a@b' }, workspace: { name: 'W' } } },
    { fn: 'setupFirstOwner', args: [{ email: 'a@b.c', password: 'x', workspaceName: 'W' }], method: 'POST', path: '/api/auth/setup', hasBody: true, expectedBody: { email: 'a@b.c', password: 'x', workspaceName: 'W' } },
    { fn: 'login', args: [{ email: 'a@b.c', password: 'x' }], method: 'POST', path: '/api/auth/login', hasBody: true, expectedBody: { email: 'a@b.c', password: 'x' } },
    { fn: 'logout', args: [], method: 'POST', path: '/api/auth/logout', status: 204 },
    { fn: 'listSites', args: [], method: 'GET', path: '/api/console/sites', response: { sites: [{ id: 's1' }] }, unwrap: (r) => r[0]?.id },
    { fn: 'getSite', args: ['s / ž'], method: 'GET', path: '/api/console/sites/s%20%2F%20%C5%BE', response: { site: { id: 's1', name: 'Test' } }, unwrap: (r) => r.id },
    { fn: 'createSite', args: [{ name: 'S' }], method: 'POST', path: '/api/console/sites', hasBody: true, expectedBody: { name: 'S' }, response: { site: { id: 'new-s' } }, unwrap: (r) => r.id },
    { fn: 'listWidgets', args: ['s / ž'], method: 'GET', path: '/api/console/sites/s%20%2F%20%C5%BE/widgets', response: { widgets: [{ id: 'w1' }] }, unwrap: (r) => r[0]?.id },
    { fn: 'createWidget', args: ['s / ž', { name: 'W' }], method: 'POST', path: '/api/console/sites/s%20%2F%20%C5%BE/widgets', hasBody: true, expectedBody: { name: 'W' }, response: { widget: { id: 'new-w' } }, unwrap: (r) => r.id },
    { fn: 'getWidgetSettings', args: ['s1', 'w1'], method: 'GET', path: '/api/console/sites/s1/widgets/w1/settings' },
    { fn: 'updateWidgetSettings', args: ['s1', 'w1', { name: 'N' }], method: 'PATCH', path: '/api/console/sites/s1/widgets/w1/settings', hasBody: true, expectedBody: { name: 'N' } },
    { fn: 'listWidgetDomains', args: ['s1', 'w1'], method: 'GET', path: '/api/console/sites/s1/widgets/w1/domains', response: { domains: [{ id: 'd1' }] }, unwrap: (r) => r[0]?.id },
    { fn: 'createWidgetDomain', args: ['s1', 'w1', { domain: 'x.com' }], method: 'POST', path: '/api/console/sites/s1/widgets/w1/domains', hasBody: true, expectedBody: { domain: 'x.com' }, response: { domain: { id: 'd1' } }, unwrap: (r) => r.id },
    { fn: 'deleteWidgetDomain', args: ['s1', 'w1', 'd / ž'], method: 'DELETE', path: '/api/console/sites/s1/widgets/w1/domains/d%20%2F%20%C5%BE', status: 204 },
  ];

  for (const { fn, args, method, path, hasBody, expectedBody, status, response, unwrap } of table) {
    test(`console-api ${fn}: exact request, result, 404, and browser-state isolation`, async () => {
      installTraps();
      try {
        // Success invocation
        const calls = installFakeFetch(response ?? {}, status ?? 200);
        const result = await apiMod[fn](...args);
        assert.equal(calls.length, 1, `${fn}: expected exactly 1 fetch call`);
        assert.equal(calls[0].url, path);
        assert.equal(calls[0].method, method);
        assert.equal(calls[0].credentials, 'include');
        assert.equal(calls[0].headers.accept, 'application/json');
        assert.ok(!calls[0].headers.Authorization, 'no Authorization header');
        if (method === 'GET') {
          assert.ok(!calls[0].headers['x-panda-csrf'], 'GET must not have CSRF');
        } else {
          assert.equal(calls[0].headers['x-panda-csrf'], '1', 'unsafe method must have CSRF');
        }
        if (hasBody) {
          assert.equal(calls[0].headers['content-type'], 'application/json');
          assert.ok(calls[0].body);
          if (expectedBody) assert.deepEqual(JSON.parse(calls[0].body), expectedBody);
        }
        if (!hasBody && method !== 'GET') {
          assert.ok(!calls[0].body, `${fn}: bodyless ${method} must not have body`);
          assert.ok(!calls[0].headers['content-type'], `${fn}: bodyless must not have content-type`);
        }
        if (unwrap) {
          const val = unwrap(result);
          assert.ok(val !== undefined, `${fn}: unwrap must produce defined value`);
        }

        // 404 invocation
        if (fn !== 'logout') {
          const calls404 = installFakeFetch({}, 404);
          await assert.rejects(() => apiMod[fn](...args), (err) => {
            assert.ok(err instanceof apiMod.ApiError, '404 must throw ApiError');
            assert.equal(err.status, 404);
            return true;
          });
          assert.equal(calls404.length, 1, `${fn} 404: exactly 1 fetch call`);
        }
      } finally {
        restoreTraps();
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// Compat: DTO fields, candidate details, diagnostics
// ═══════════════════════════════════════════════════════════════

describe('NEXT_LOCAL_REPLY_CANDIDATE_FIELDS exact tuple', () => {
  test('exactly 7 frozen fields in order', () => {
    assert.deepEqual([...compatMod.NEXT_LOCAL_REPLY_CANDIDATE_FIELDS],
      ['id', 'status', 'conversationId', 'visitorMessageId', 'clientMessageId', 'createdAt', 'claimedAt']);
  });
});

describe('nextLocalReplyCandidateDetails via throwing Proxy', () => {
  test('accesses only the 7 allowed fields', () => {
    const candidate = new Proxy(Object.create(null), {
      ownKeys() { throw new Error('ownKeys must not be called'); },
      get(_, key) {
        if (typeof key === 'symbol' || key === 'then') return undefined;
        if (!['id', 'status', 'conversationId', 'visitorMessageId', 'clientMessageId', 'createdAt', 'claimedAt'].includes(key)) {
          throw new Error(`Unexpected field access: ${String(key)}`);
        }
        return key === 'claimedAt' ? null : `val-${String(key)}`;
      },
    });
    const details = compatMod.nextLocalReplyCandidateDetails(candidate);
    assert.equal(details.length, 6);
    assert.deepEqual(details.map(d => d.label), ['status', 'conversationId', 'visitorMessageId', 'clientMessageId', 'createdAt', 'claimedAt']);
    assert.equal(details[5].value, 'not claimed yet');
    assert.equal(details[0].value, 'val-status');
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
            throw new Error(`diagnostics read forbidden: connection.${String(ck)}`);
          },
        });
        throw new Error(`diagnostics read forbidden: ${String(key)}`);
      },
    });
    const calls = [];
    const result = await compatMod.loadLocalDiagnostics('s1', 'w1', 'old-c', {
      getWidgetSettings: async (s, w) => { calls.push([s, w]); return response; },
      isCurrent: () => true,
    });
    assert.deepEqual(calls, [['s1', 'w1']]);
    assert.equal(result.status, 'ready');
    assert.equal(result.localDelivery, localDelivery);
    assert.equal(result.candidateChanged, true);
  });

  test('candidateChanged false when same', async () => {
    const localDelivery = { nextLocalReplyCandidate: { id: 'same' }, queuedIntentCount: 0, claimedIntentCount: 0, appliedLocalReplyCount: 0, lastQueuedAt: null, lastClaimedAt: null, lastAppliedLocalReplyAt: null };
    const result = await compatMod.loadLocalDiagnostics('s1', 'w1', 'same', {
      getWidgetSettings: async () => ({ connection: { localDelivery } }),
      isCurrent: () => true,
    });
    assert.equal(result.candidateChanged, false);
  });

  test('stale success', async () => {
    const result = await compatMod.loadLocalDiagnostics('s1', 'w1', null, {
      getWidgetSettings: async () => ({ connection: { localDelivery: { nextLocalReplyCandidate: null } } }),
      isCurrent: () => false,
    });
    assert.deepEqual(result, { status: 'stale' });
  });

  test('stale error', async () => {
    const result = await compatMod.loadLocalDiagnostics('s1', 'w1', null, {
      getWidgetSettings: async () => { throw new Error('net'); },
      isCurrent: () => false,
    });
    assert.deepEqual(result, { status: 'stale' });
  });

  test('generic error when current', async () => {
    const result = await compatMod.loadLocalDiagnostics('s1', 'w1', null, {
      getWidgetSettings: async () => { throw new Error('net'); },
      isCurrent: () => true,
    });
    assert.deepEqual(result, { status: 'error' });
  });
});

describe('mergeLocalDiagnostics preserves unrelated identities', () => {
  test('merges only localDelivery, preserves all else', () => {
    const domains = [{ id: 'd1', domain: 'x.com', createdAt: '2026-01-01T00:00:00Z' }];
    const sentinelWidget = Object.freeze({ name: 'W', publicKey: 'pk' });
    const sentinelConfig = Object.freeze({ assistant: { displayName: 'A' }, launcher: { label: 'L', icon: 'message' }, welcome: { title: 'T', subtitle: 'S' }, theme: { colorMode: 'light', accent: 'blue', radius: 'md' } });
    const sentinelInstall = Object.freeze({ snippetAvailable: true, snippet: '<script>' });
    const oldDelivery = Object.freeze({ nextLocalReplyCandidate: null, queuedIntentCount: 0, claimedIntentCount: 0, appliedLocalReplyCount: 0, lastQueuedAt: null, lastClaimedAt: null, lastAppliedLocalReplyAt: null });
    const state = { status: 'ready', settings: { widget: sentinelWidget, config: sentinelConfig, install: sentinelInstall, connection: { status: 'configured_placeholder', routeHandle: 'r', localDelivery: oldDelivery } }, domains };
    const newDelivery = Object.freeze({ nextLocalReplyCandidate: { id: 'new' }, queuedIntentCount: 1, claimedIntentCount: 0, appliedLocalReplyCount: 0, lastQueuedAt: null, lastClaimedAt: null, lastAppliedLocalReplyAt: null });
    const merged = compatMod.mergeLocalDiagnostics(state, newDelivery);
    assert.equal(merged.settings.widget, sentinelWidget);
    assert.equal(merged.settings.config, sentinelConfig);
    assert.equal(merged.settings.install, sentinelInstall);
    assert.equal(merged.settings.connection.status, 'configured_placeholder');
    assert.equal(merged.settings.connection.routeHandle, 'r');
    assert.equal(merged.settings.connection.localDelivery, newDelivery);
    assert.equal(merged.domains, domains);
  });

  test('non-ready state returns unchanged', () => {
    const state = { status: 'loading' };
    assert.equal(compatMod.mergeLocalDiagnostics(state, {}), state);
  });
});
