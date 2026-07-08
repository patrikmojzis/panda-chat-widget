import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildApp } from './app.ts';
import type { DatabaseClient } from './db.ts';
import type { AllowedDomainRecord } from './origin-domain.ts';
import { DEMO_SEED_DATA } from './seed-data.ts';
import { DEFAULT_WIDGET_BOOTSTRAP_CONFIG, type WidgetBootstrapConfigRow } from './widget-bootstrap.ts';

type WidgetLookupRow = {
  widgetId: string;
  siteId: string;
  publicKey: string;
  panda_route_handle?: string | null;
  widgetEnabled: boolean;
  siteEnabled: boolean;
};

type FakeDatabaseOptions = {
  widget?: WidgetLookupRow;
  widgetConfig?: WidgetBootstrapConfigRow;
  allowedDomains?: AllowedDomainRecord[];
};

type FakeDatabase = {
  database: DatabaseClient;
  publicKeyLookups: string[];
  allowedDomainWidgetLookups: string[];
  enabledDomainFilters: boolean[];
  configWidgetLookups: string[];
};

function createFakeDatabase(options: FakeDatabaseOptions): FakeDatabase {
  const publicKeyLookups: string[] = [];
  const allowedDomainWidgetLookups: string[] = [];
  const enabledDomainFilters: boolean[] = [];
  const configWidgetLookups: string[] = [];

  function createWidgetQuery() {
    let joined = false;

    const query = {
      innerJoin: () => {
        joined = true;
        return query;
      },
      select: () => query,
      where: (column: string, _operator: string, value: string) => {
        if (column === 'widgets.public_key') {
          publicKeyLookups.push(value);
        }

        if (column === 'id') {
          configWidgetLookups.push(value);
        }

        return query;
      },
      executeTakeFirst: async () => joined ? options.widget : (options.widgetConfig ?? DEFAULT_WIDGET_CONFIG_ROW),
    };

    return query;
  }

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
        return createWidgetQuery();
      }

      if (table === 'allowed_domains') {
        return allowedDomainsQuery;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as DatabaseClient;

  return { database, publicKeyLookups, allowedDomainWidgetLookups, enabledDomainFilters, configWidgetLookups };
}


const DEFAULT_WIDGET_CONFIG_ROW = {
  assistant_display_name: 'Support',
  launcher_label: 'Chat',
  launcher_icon: 'message',
  welcome_title: 'Hi there',
  welcome_subtitle: 'Send us a message and we will reply as soon as we can.',
  theme_color_mode: 'system',
  theme_accent: 'blue',
  theme_radius: 'md',
} satisfies WidgetBootstrapConfigRow;


function assertNoPandaConnectionFields(value: unknown): void {
  const serialized = JSON.stringify(value);

  assert.doesNotMatch(
    serialized,
    /connection|routeHandle|panda_route_handle|claim|claimed|claimedAt|claimed_at|deliveryIntent|deliveryStatus|panda_delivery_intent|pandaDeliveryIntent|nextLocalReplyCandidate|nextLocalReplyTarget|replyTarget|targetIntentId|intentId|localDelivery|queuedIntentCount|lastQueuedAt|claimedIntentCount|lastClaimedAt|appliedLocalReplyCount|lastAppliedLocalReplyAt/i,
  );
}

function enabledDemoWidget(): WidgetLookupRow {
  return {
    widgetId: 'widget-id',
    siteId: 'site-id',
    publicKey: DEMO_SEED_DATA.publicWidgetKey,
    panda_route_handle: 'panda:workspace/alpha',
    widgetEnabled: true,
    siteEnabled: true,
  };
}


const widgetBootstrapSource = await readFile(new URL('./widget-bootstrap.ts', import.meta.url), 'utf8');

test('default widget bootstrap config uses plain text and tokenized values', () => {
  assert.deepEqual(DEFAULT_WIDGET_BOOTSTRAP_CONFIG, {
    assistant: {
      displayName: 'Support',
    },
    launcher: {
      label: 'Chat',
      icon: 'message',
    },
    welcome: {
      title: 'Hi there',
      subtitle: 'Send us a message and we will reply as soon as we can.',
    },
    theme: {
      colorMode: 'system',
      accent: 'blue',
      radius: 'md',
    },
  });

  const plainTextValues = [
    DEFAULT_WIDGET_BOOTSTRAP_CONFIG.assistant.displayName,
    DEFAULT_WIDGET_BOOTSTRAP_CONFIG.launcher.label,
    DEFAULT_WIDGET_BOOTSTRAP_CONFIG.welcome.title,
    DEFAULT_WIDGET_BOOTSTRAP_CONFIG.welcome.subtitle,
  ];

  for (const value of plainTextValues) {
    assert.doesNotMatch(value, /[<>]/);
  }

  const tokenValues = [
    DEFAULT_WIDGET_BOOTSTRAP_CONFIG.launcher.icon,
    DEFAULT_WIDGET_BOOTSTRAP_CONFIG.theme.colorMode,
    DEFAULT_WIDGET_BOOTSTRAP_CONFIG.theme.accent,
    DEFAULT_WIDGET_BOOTSTRAP_CONFIG.theme.radius,
  ];

  for (const value of tokenValues) {
    assert.match(value, /^[a-z][a-z0-9_]*$/);
  }
});

test('widget bootstrap theme config is token-only and has no arbitrary style or HTML fields', () => {
  assert.match(widgetBootstrapSource, /export type WidgetThemeMode = 'light' \| 'dark' \| 'system';/);
  assert.match(widgetBootstrapSource, /export type WidgetAccentToken = 'blue';/);
  assert.match(widgetBootstrapSource, /export type WidgetRadiusToken = 'md';/);
  assert.match(widgetBootstrapSource, /DEFAULT_WIDGET_BOOTSTRAP_CONFIG[\s\S]*satisfies WidgetBootstrapConfig/);
  assert.doesNotMatch(widgetBootstrapSource, /\b(?:style|styles|css|customCss|html|markup|unsafeHtml)\b/i);
  assert.doesNotMatch(widgetBootstrapSource, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|cssText|url\(/);
});

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
      config: DEFAULT_WIDGET_BOOTSTRAP_CONFIG,
    });
    assertNoPandaConnectionFields(response.json());
    assert.deepEqual(fake.publicKeyLookups, [DEMO_SEED_DATA.publicWidgetKey]);
    assert.deepEqual(fake.configWidgetLookups, ['widget-id']);
    assert.deepEqual(fake.allowedDomainWidgetLookups, ['widget-id']);
    assert.deepEqual(fake.enabledDomainFilters, [true]);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/bootstrap returns persisted safe config fields', async () => {
  const fake = createFakeDatabase({
    widget: enabledDemoWidget(),
    widgetConfig: {
      assistant_display_name: 'Helper',
      launcher_label: 'Ask us',
      launcher_icon: 'message',
      welcome_title: 'Welcome in',
      welcome_subtitle: 'Plain text only.',
      theme_color_mode: 'dark',
      theme_accent: 'blue',
      theme_radius: 'md',
    },
    allowedDomains: [{ domain: 'localhost', enabled: true }],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/bootstrap`,
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().config, {
      assistant: { displayName: 'Helper' },
      launcher: { label: 'Ask us', icon: 'message' },
      welcome: { title: 'Welcome in', subtitle: 'Plain text only.' },
      theme: { colorMode: 'dark', accent: 'blue', radius: 'md' },
    });
    assertNoPandaConnectionFields(response.json());
    assert.deepEqual(fake.configWidgetLookups, ['widget-id']);
  } finally {
    await app.close();
  }
});

test('GET /api/widgets/:publicKey/bootstrap rejects invalid public keys before widget lookup', async () => {
  const fake = createFakeDatabase({ widget: enabledDemoWidget() });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/widgets/%20/bootstrap',
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'invalid_widget_request', reason: 'missing_public_key' });
    assert.deepEqual(fake.publicKeyLookups, []);
    assert.deepEqual(fake.allowedDomainWidgetLookups, []);
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

test('GET /api/widgets/:publicKey/bootstrap rejects disabled allowed-domain records', async () => {
  const fake = createFakeDatabase({
    widget: enabledDemoWidget(),
    allowedDomains: [{ domain: 'localhost', enabled: false }],
  });
  const app = buildApp({ database: fake.database });

  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/widgets/${DEMO_SEED_DATA.publicWidgetKey}/bootstrap`,
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'origin_not_allowed', reason: 'domain_not_allowed' });
    assert.deepEqual(fake.allowedDomainWidgetLookups, ['widget-id']);
    assert.deepEqual(fake.enabledDomainFilters, [true]);
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
