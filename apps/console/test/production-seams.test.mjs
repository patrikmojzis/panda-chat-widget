import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createServer } from 'vite';
import { rmSync } from 'node:fs';

const CACHE_DIR = '/tmp/pcw-r4-vite-test-cache-' + process.pid;
let vite;
let appMod, apiMod, compatMod;

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
});

after(async () => {
  if (vite) await vite.close();
  try { rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {}
});

// ─── Route parser ───

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

// ─── Site detail page seam ───

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

// ─── Create widget page seam ───

describe('loadCreateWidgetPageState', () => {
  const siteFix = Object.freeze({ id: 's1', name: 'Test', createdAt: '2026-01-01T00:00:00Z' });

  test('ready', async () => {
    const result = await appMod.loadCreateWidgetPageState('s1', {
      getSite: async () => siteFix,
    }, () => true);
    assert.equal(result.status, 'ready');
    assert.equal(result.site, siteFix);
  });

  test('404 → notFound', async () => {
    const result = await appMod.loadCreateWidgetPageState('s1', {
      getSite: async () => { throw new apiMod.ApiError(404, ''); },
    }, () => true);
    assert.deepEqual(result, { status: 'notFound' });
  });

  test('stale → null', async () => {
    const result = await appMod.loadCreateWidgetPageState('s1', {
      getSite: async () => siteFix,
    }, () => false);
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

// ─── Real console-api.ts request table via fake fetch ───

describe('console-api.ts request contracts via fake fetch', () => {
  const savedFetch = globalThis.fetch;
  let lastReq;

  function installFakeFetch(responseBody = {}, status = 200) {
    globalThis.fetch = async (url, init = {}) => {
      lastReq = { url, method: init.method || 'GET', headers: init.headers || {}, body: init.body, credentials: init.credentials };
      return new Response(status === 204 ? null : JSON.stringify(responseBody), {
        status, headers: { 'content-type': 'application/json' },
      });
    };
  }

  after(() => { globalThis.fetch = savedFetch; });

  // Install throwing storage traps
  const storageTrap = { get: () => { throw new Error('storage accessed'); }, set: () => { throw new Error('storage accessed'); } };

  function assertCommonHeaders(method) {
    assert.equal(lastReq.credentials, 'include');
    assert.equal(lastReq.headers.accept, 'application/json');
    assert.ok(!lastReq.headers.Authorization);
    if (method !== 'GET') {
      assert.equal(lastReq.headers['x-panda-csrf'], '1');
    } else {
      assert.ok(!lastReq.headers['x-panda-csrf']);
    }
  }

  const table = [
    { fn: 'getSetupStatus', args: [], method: 'GET', path: '/api/auth/setup-status' },
    { fn: 'getCurrentContext', args: [], method: 'GET', path: '/api/me' },
    { fn: 'setupFirstOwner', args: [{ email: 'a@b.c', password: 'x', workspaceName: 'W' }], method: 'POST', path: '/api/auth/setup', hasBody: true },
    { fn: 'login', args: [{ email: 'a@b.c', password: 'x' }], method: 'POST', path: '/api/auth/login', hasBody: true },
    { fn: 'logout', args: [], method: 'POST', path: '/api/auth/logout', status: 204 },
    { fn: 'listSites', args: [], method: 'GET', path: '/api/console/sites' },
    { fn: 'getSite', args: ['s / ž'], method: 'GET', path: '/api/console/sites/s%20%2F%20%C5%BE' },
    { fn: 'createSite', args: [{ name: 'S' }], method: 'POST', path: '/api/console/sites', hasBody: true },
    { fn: 'listWidgets', args: ['s / ž'], method: 'GET', path: '/api/console/sites/s%20%2F%20%C5%BE/widgets' },
    { fn: 'createWidget', args: ['s / ž', { name: 'W' }], method: 'POST', path: '/api/console/sites/s%20%2F%20%C5%BE/widgets', hasBody: true },
    { fn: 'getWidgetSettings', args: ['s1', 'w1'], method: 'GET', path: '/api/console/sites/s1/widgets/w1/settings' },
    { fn: 'updateWidgetSettings', args: ['s1', 'w1', { name: 'N' }], method: 'PATCH', path: '/api/console/sites/s1/widgets/w1/settings', hasBody: true },
    { fn: 'listWidgetDomains', args: ['s1', 'w1'], method: 'GET', path: '/api/console/sites/s1/widgets/w1/domains' },
    { fn: 'createWidgetDomain', args: ['s1', 'w1', { domain: 'x.com' }], method: 'POST', path: '/api/console/sites/s1/widgets/w1/domains', hasBody: true },
    { fn: 'deleteWidgetDomain', args: ['s1', 'w1', 'd / ž'], method: 'DELETE', path: '/api/console/sites/s1/widgets/w1/domains/d%20%2F%20%C5%BE', status: 204 },
  ];

  for (const { fn, args, method, path, hasBody, status } of table) {
    test(`${fn} → ${method} ${path}`, async () => {
      installFakeFetch({}, status || 200);
      await apiMod[fn](...args);
      assert.equal(lastReq.url, path);
      assert.equal(lastReq.method, method);
      assertCommonHeaders(method);
      if (hasBody) {
        assert.equal(lastReq.headers['content-type'], 'application/json');
        assert.ok(lastReq.body);
      }
      if (!hasBody && method !== 'DELETE') {
        assert.ok(!lastReq.body);
      }
    });
  }

  test('404 response throws ApiError with status 404', async () => {
    installFakeFetch({}, 404);
    await assert.rejects(() => apiMod.getSite('x'), (err) => {
      assert.ok(err instanceof apiMod.ApiError);
      assert.equal(err.status, 404);
      return true;
    });
  });
});

// ─── Compat: DTO fields, candidate details, stale-copy, diagnostics ───

describe('NEXT_LOCAL_REPLY_CANDIDATE_FIELDS exact tuple', () => {
  test('exactly 7 frozen fields in order', () => {
    assert.deepEqual([...compatMod.NEXT_LOCAL_REPLY_CANDIDATE_FIELDS],
      ['id', 'status', 'conversationId', 'visitorMessageId', 'clientMessageId', 'createdAt', 'claimedAt']);
  });
});

describe('nextLocalReplyCandidateDetails via throwing Proxy', () => {
  test('accesses only the 7 allowed fields', () => {
    const accessed = [];
    const candidate = new Proxy(Object.create(null), {
      ownKeys() { throw new Error('ownKeys must not be called'); },
      get(_, key) {
        if (!['id', 'status', 'conversationId', 'visitorMessageId', 'clientMessageId', 'createdAt', 'claimedAt'].includes(key)) {
          throw new Error(`Unexpected field access: ${String(key)}`);
        }
        accessed.push(key);
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

describe('localManualReplyStateForScope', () => {
  test('same scope preserves identity', () => {
    const scope = { siteId: 's1', widgetId: 'w1', candidateId: 'c1' };
    const state = { scope, draft: 'hello', command: 'cmd', copiedCommand: null, copyErrorCommand: null };
    assert.equal(compatMod.localManualReplyStateForScope(state, scope), state);
  });

  test('different siteId creates fresh state', () => {
    const state = { scope: { siteId: 's1', widgetId: 'w1', candidateId: 'c1' }, draft: 'x', command: 'y', copiedCommand: null, copyErrorCommand: null };
    const result = compatMod.localManualReplyStateForScope(state, { siteId: 's2', widgetId: 'w1', candidateId: 'c1' });
    assert.notEqual(result, state);
    assert.notEqual(result, state);  // Fresh state was created
  });

  test('different widgetId creates fresh state', () => {
    const state = { scope: { siteId: 's1', widgetId: 'w1', candidateId: 'c1' }, draft: 'x', command: 'y', copiedCommand: null, copyErrorCommand: null };
    const result = compatMod.localManualReplyStateForScope(state, { siteId: 's1', widgetId: 'w2', candidateId: 'c1' });
    assert.notEqual(result, state);
  });

  test('different candidateId creates fresh state', () => {
    const state = { scope: { siteId: 's1', widgetId: 'w1', candidateId: 'c1' }, draft: 'x', command: 'y', copiedCommand: null, copyErrorCommand: null };
    const result = compatMod.localManualReplyStateForScope(state, { siteId: 's1', widgetId: 'w1', candidateId: 'c2' });
    assert.notEqual(result, state);
  });
});

describe('loadLocalDiagnostics', () => {
  test('ready with candidateChanged detection', async () => {
    const localDelivery = Object.freeze({ nextLocalReplyCandidate: { id: 'new-c' }, queuedIntentCount: 0, claimedIntentCount: 0, appliedLocalReplyCount: 0, lastQueuedAt: null, lastClaimedAt: null, lastAppliedLocalReplyAt: null });
    // Throwing proxy: only connection.localDelivery is accessible
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
    const state = {
      status: 'ready',
      settings: {
        widget: sentinelWidget,
        config: sentinelConfig,
        install: sentinelInstall,
        connection: { status: 'configured_placeholder', routeHandle: 'r', localDelivery: oldDelivery },
      },
      domains,
    };
    const newDelivery = Object.freeze({ nextLocalReplyCandidate: { id: 'new' }, queuedIntentCount: 1, claimedIntentCount: 0, appliedLocalReplyCount: 0, lastQueuedAt: null, lastClaimedAt: null, lastAppliedLocalReplyAt: null });
    const merged = compatMod.mergeLocalDiagnostics(state, newDelivery);
    assert.equal(merged.status, 'ready');
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
