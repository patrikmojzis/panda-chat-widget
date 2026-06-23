import assert from 'node:assert/strict';
import test from 'node:test';

import type { DatabaseClient } from './db.ts';
import { DEMO_SEED_DATA } from './seed-data.ts';
import { findWidgetByPublicKey } from './widget-lookup.ts';

type LookupRow = {
  widgetId: string;
  siteId: string;
  publicKey: string;
  widgetEnabled: boolean;
  siteEnabled: boolean;
};

type FakeDatabase = {
  database: DatabaseClient;
  publicKeyLookups: string[];
};

function databaseReturning(row: LookupRow | undefined): FakeDatabase {
  const publicKeyLookups: string[] = [];

  const query = {
    innerJoin: () => query,
    select: () => query,
    where: (_column: string, _operator: string, publicKey: string) => {
      publicKeyLookups.push(publicKey);
      return query;
    },
    executeTakeFirst: async () => row,
  };

  const database = {
    selectFrom: () => query,
  } as unknown as DatabaseClient;

  return { database, publicKeyLookups };
}

test('findWidgetByPublicKey returns server-owned fields for an enabled public widget', async () => {
  const { database, publicKeyLookups } = databaseReturning({
    widgetId: 'widget-id',
    siteId: 'site-id',
    publicKey: DEMO_SEED_DATA.publicWidgetKey,
    widgetEnabled: true,
    siteEnabled: true,
  });

  const result = await findWidgetByPublicKey(database, DEMO_SEED_DATA.publicWidgetKey);

  assert.deepEqual(publicKeyLookups, [DEMO_SEED_DATA.publicWidgetKey]);
  assert.deepEqual(result, {
    status: 'found',
    widget: {
      id: 'widget-id',
      siteId: 'site-id',
      publicKey: 'demo-local-widget',
    },
  });
});

test('findWidgetByPublicKey represents a missing public widget explicitly', async () => {
  const { database } = databaseReturning(undefined);

  assert.deepEqual(await findWidgetByPublicKey(database, 'missing-widget'), { status: 'not_found' });
});

test('findWidgetByPublicKey represents a disabled widget explicitly', async () => {
  const { database } = databaseReturning({
    widgetId: 'widget-id',
    siteId: 'site-id',
    publicKey: 'disabled-widget',
    widgetEnabled: false,
    siteEnabled: true,
  });

  assert.deepEqual(await findWidgetByPublicKey(database, 'disabled-widget'), {
    status: 'disabled',
    reason: 'widget_disabled',
  });
});

test('findWidgetByPublicKey represents a disabled site explicitly', async () => {
  const { database } = databaseReturning({
    widgetId: 'widget-id',
    siteId: 'site-id',
    publicKey: 'disabled-site-widget',
    widgetEnabled: true,
    siteEnabled: false,
  });

  assert.deepEqual(await findWidgetByPublicKey(database, 'disabled-site-widget'), {
    status: 'disabled',
    reason: 'site_disabled',
  });
});
