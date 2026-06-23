import assert from 'node:assert/strict';
import test from 'node:test';

import type { Insertable } from 'kysely';
import type { DatabaseSchema } from './db.ts';
import { DEMO_SEED_DATA } from './seed-data.ts';

test('demo seed data uses stable local widget values', () => {
  assert.equal(DEMO_SEED_DATA.siteName, 'Demo Local Site');
  assert.equal(DEMO_SEED_DATA.widgetName, 'Demo Local Widget');
  assert.equal(DEMO_SEED_DATA.publicWidgetKey, 'demo-local-widget');
  assert.deepEqual(DEMO_SEED_DATA.allowedDomains, ['localhost', '127.0.0.1']);
  assert.equal(new Set(DEMO_SEED_DATA.allowedDomains).size, DEMO_SEED_DATA.allowedDomains.length);
});

test('demo seed data matches the typed widget schema inserts', () => {
  const site = {
    name: DEMO_SEED_DATA.siteName,
    enabled: true,
  } satisfies Insertable<DatabaseSchema['sites']>;

  const widget = {
    site_id: 'site-id',
    public_key: DEMO_SEED_DATA.publicWidgetKey,
    name: DEMO_SEED_DATA.widgetName,
    enabled: true,
  } satisfies Insertable<DatabaseSchema['widgets']>;

  const domains = DEMO_SEED_DATA.allowedDomains.map((domain) => ({
    widget_id: 'widget-id',
    domain,
    enabled: true,
  } satisfies Insertable<DatabaseSchema['allowed_domains']>));

  assert.equal(site.name, 'Demo Local Site');
  assert.equal(widget.public_key, 'demo-local-widget');
  assert.equal(domains.length, 2);
});
