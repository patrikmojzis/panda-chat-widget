import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { Insertable, Updateable } from 'kysely';
import type { DatabaseSchema } from './db.ts';
import { DEMO_SEED_DATA } from './seed-data.ts';

const seedDataSource = readFileSync(new URL('./seed-data.ts', import.meta.url), 'utf8');

test('demo seed data uses stable local widget values', () => {
  assert.equal(DEMO_SEED_DATA.siteName, 'Demo Local Site');
  assert.equal(DEMO_SEED_DATA.widgetName, 'Demo Local Widget');
  assert.equal(DEMO_SEED_DATA.publicWidgetKey, 'demo-local-widget');
  assert.equal(DEMO_SEED_DATA.pandaRouteHandle, 'panda:local/demo');
  assert.equal(DEMO_SEED_DATA.pandaRouteHandle.includes('://'), false);
  assert.deepEqual(DEMO_SEED_DATA.allowedDomains, ['localhost', '127.0.0.1']);
  assert.equal(new Set(DEMO_SEED_DATA.allowedDomains).size, DEMO_SEED_DATA.allowedDomains.length);
});

test('demo seed data matches the typed widget schema inserts', () => {
  const site = {
    workspace_id: null,
    name: DEMO_SEED_DATA.siteName,
    enabled: true,
  } satisfies Insertable<DatabaseSchema['sites']>;

  const widget = {
    site_id: 'site-id',
    public_key: DEMO_SEED_DATA.publicWidgetKey,
    name: DEMO_SEED_DATA.widgetName,
    enabled: true,
    panda_route_handle: DEMO_SEED_DATA.pandaRouteHandle,
  } satisfies Insertable<DatabaseSchema['widgets']>;

  const widgetUpdate = {
    site_id: 'site-id',
    name: DEMO_SEED_DATA.widgetName,
    enabled: true,
    panda_route_handle: DEMO_SEED_DATA.pandaRouteHandle,
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
  } satisfies Updateable<DatabaseSchema['widgets']>;

  const domains = DEMO_SEED_DATA.allowedDomains.map((domain) => ({
    widget_id: 'widget-id',
    domain,
    enabled: true,
  } satisfies Insertable<DatabaseSchema['allowed_domains']>));

  assert.equal(site.workspace_id, null);
  assert.equal(site.name, 'Demo Local Site');
  assert.equal(widget.public_key, 'demo-local-widget');
  assert.equal(widget.panda_route_handle, 'panda:local/demo');
  assert.equal(widgetUpdate.panda_route_handle, 'panda:local/demo');
  assert.equal(domains.length, 2);
});


test('seedDemoData upserts the demo widget route handle on insert and conflict repair', () => {
  const widgetUpsertSource = sourceBetween(
    seedDataSource,
    'async function upsertDemoWidget',
    '\nasync function upsertAllowedDomain',
  );

  assert.match(
    widgetUpsertSource,
    /const values = \{[\s\S]*panda_route_handle: seed\.pandaRouteHandle,[\s\S]*\} satisfies Insertable<DatabaseSchema\['widgets'\]>/,
  );
  assert.match(widgetUpsertSource, /\.onConflict\(\(oc\) => oc\.column\('public_key'\)\.doUpdateSet\(\{/);
  assert.match(
    widgetUpsertSource,
    /doUpdateSet\(\{[\s\S]*panda_route_handle: seed\.pandaRouteHandle,[\s\S]*updated_at: new Date\(\),[\s\S]*\}\)\)/,
  );
});

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  assert.notEqual(startIndex, -1, `missing source start marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source end marker: ${end}`);

  return source.slice(startIndex, endIndex);
}
