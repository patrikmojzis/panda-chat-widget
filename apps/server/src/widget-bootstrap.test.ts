import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from './app.ts';
import type { DatabaseClient } from './db.ts';
import type { AllowedDomainRecord } from './origin-domain.ts';
import { DEMO_SEED_DATA } from './seed-data.ts';

type WidgetLookupRow = {
  widgetId: string;
  siteId: string;
  publicKey: string;
  widgetEnabled: boolean;
  siteEnabled: boolean;
};

type FakeDatabaseOptions = {
  widget?: WidgetLookupRow;
  allowedDomains?: AllowedDomainRecord[];
};

type FakeDatabase = {
  database: DatabaseClient;
  publicKeyLookups: string[];
  allowedDomainWidgetLookups: string[];
  enabledDomainFilters: boolean[];
};

function createFakeDatabase(options: FakeDatabaseOptions): FakeDatabase {
  const publicKeyLookups: string[] = [];
  const allowedDomainWidgetLookups: string[] = [];
  const enabledDomainFilters: boolean[] = [];

  const widgetQuery = {
    innerJoin: () => widgetQuery,
    select: () => widgetQuery,
    where: (_column: string, _operator: string, value: string) => {
      publicKeyLookups.push(value);
      return widgetQuery;
    },
    executeTakeFirst: async () => options.widget,
  };

  const allowedDomainsQuery = {
    select: () => allowedDomainsQuery,
    where: (column: string, _operator: string, value: string | boolean) => {
      if (column === 'widget_id' && typeof value === 'string') {
        allowedDomainWidgetLookups.push(value);
      }

      if (column === 'enabled' && typeof value === 'boolean') {
        enabledDomainFilters.push(value);
      }

      return allowedDomainsQuery;
    },
    execute: async () =>
      enabledDomainFilters.includes(true)
        ? (options.allowedDomains ?? []).filter((allowedDomain) => allowedDomain.enabled)
        : (options.allowedDomains ?? []),
  };

  const database = {
    selectFrom: (table: string) => {
      if (table === 'widgets') {
        return widgetQuery;
      }

      if (table === 'allowed_domains') {
        return allowedDomainsQuery;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as DatabaseClient;

  return { database, publicKeyLookups, allowedDomainWidgetLookups, enabledDomainFilters };
}

function enabledDemoWidget(): WidgetLookupRow {
  return {
    widgetId: 'widget-id',
    siteId: 'site-id',
    publicKey: DEMO_SEED_DATA.publicWidgetKey,
    widgetEnabled: true,
    siteEnabled: true,
  };
}

test('GET /api/widgets/:publicKey/bootstrap returns safe bootstrap JSON for an enabled widget and allowed origin', async () => {
  const fake = createFakeDatabase({
    widget: enabledDemoWidget(),
    allowedDomains: [{ domain: 'localhost', enabled: true }],
  });
  const app = buildApp({ database: fake.database });

  try {
    assert.equal(app.server.listening, false);

    const response = await app.inject({
      method: 'GET',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/bootstrap`,
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      widget: {
        publicKey: 'demo-local-widget',
      },
      origin: {
        hostname: 'localhost',
        domain: 'localhost',
      },
    });
    assert.deepEqual(fake.publicKeyLookups, [DEMO_SEED_DATA.publicWidgetKey]);
    assert.deepEqual(fake.allowedDomainWidgetLookups, ['widget-id']);
    assert.deepEqual(fake.enabledDomainFilters, [true]);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/bootstrap rejects an unknown widget', async () => {
  const fake = createFakeDatabase({});
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/widgets/missing-widget/bootstrap',
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'widget_not_found' });
    assert.deepEqual(fake.allowedDomainWidgetLookups, []);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/bootstrap rejects a disabled widget', async () => {
  const fake = createFakeDatabase({
    widget: { ...enabledDemoWidget(), widgetEnabled: false },
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/bootstrap`,
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'widget_disabled', reason: 'widget_disabled' });
    assert.deepEqual(fake.allowedDomainWidgetLookups, []);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/bootstrap rejects a disabled site', async () => {
  const fake = createFakeDatabase({
    widget: { ...enabledDemoWidget(), siteEnabled: false },
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/bootstrap`,
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'widget_disabled', reason: 'site_disabled' });
    assert.deepEqual(fake.allowedDomainWidgetLookups, []);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/bootstrap rejects missing origins', async () => {
  const fake = createFakeDatabase({
    widget: enabledDemoWidget(),
    allowedDomains: [{ domain: 'localhost', enabled: true }],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/bootstrap`,
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'origin_not_allowed', reason: 'missing_origin' });
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/bootstrap rejects invalid origins', async () => {
  const fake = createFakeDatabase({
    widget: enabledDemoWidget(),
    allowedDomains: [{ domain: 'localhost', enabled: true }],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/bootstrap`,
      headers: { origin: 'not a url' },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'origin_not_allowed', reason: 'invalid_origin' });
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/bootstrap rejects disallowed origins', async () => {
  const fake = createFakeDatabase({
    widget: enabledDemoWidget(),
    allowedDomains: [{ domain: 'localhost', enabled: true }],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/bootstrap`,
      headers: { origin: 'https://example.com' },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'origin_not_allowed', reason: 'domain_not_allowed' });
  } finally {
    await app.close();
  }
});
