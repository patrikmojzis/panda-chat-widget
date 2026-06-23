import type { Insertable } from 'kysely';

import type { DatabaseClient, DatabaseSchema } from './db.ts';

export type DemoSeedData = {
  siteName: string;
  widgetName: string;
  publicWidgetKey: string;
  allowedDomains: readonly string[];
};

export type DemoSeedResult = {
  siteId: string;
  widgetId: string;
  publicWidgetKey: string;
  allowedDomains: readonly string[];
};

export const DEMO_SEED_DATA = {
  siteName: 'Demo Local Site',
  widgetName: 'Demo Local Widget',
  publicWidgetKey: 'demo-local-widget',
  allowedDomains: ['localhost', '127.0.0.1'],
} as const satisfies DemoSeedData;

export async function seedDemoData(
  database: DatabaseClient,
  seed: DemoSeedData = DEMO_SEED_DATA,
): Promise<DemoSeedResult> {
  const site = await ensureDemoSite(database, seed.siteName);
  const widget = await upsertDemoWidget(database, site.id, seed);

  for (const domain of seed.allowedDomains) {
    await upsertAllowedDomain(database, widget.id, domain);
  }

  return {
    siteId: site.id,
    widgetId: widget.id,
    publicWidgetKey: widget.public_key,
    allowedDomains: seed.allowedDomains,
  };
}

async function ensureDemoSite(database: DatabaseClient, siteName: string): Promise<{ id: string }> {
  const existingSite = await database
    .selectFrom('sites')
    .select('id')
    .where('name', '=', siteName)
    .executeTakeFirst();

  if (existingSite) {
    await database
      .updateTable('sites')
      .set({ enabled: true, updated_at: new Date() })
      .where('id', '=', existingSite.id)
      .execute();

    return existingSite;
  }

  const values = {
    name: siteName,
    enabled: true,
  } satisfies Insertable<DatabaseSchema['sites']>;

  return database.insertInto('sites').values(values).returning('id').executeTakeFirstOrThrow();
}

async function upsertDemoWidget(
  database: DatabaseClient,
  siteId: string,
  seed: DemoSeedData,
): Promise<{ id: string; public_key: string }> {
  const values = {
    site_id: siteId,
    public_key: seed.publicWidgetKey,
    name: seed.widgetName,
    enabled: true,
  } satisfies Insertable<DatabaseSchema['widgets']>;

  return database
    .insertInto('widgets')
    .values(values)
    .onConflict((oc) => oc.column('public_key').doUpdateSet({
      site_id: siteId,
      name: seed.widgetName,
      enabled: true,
      updated_at: new Date(),
    }))
    .returning(['id', 'public_key'])
    .executeTakeFirstOrThrow();
}

async function upsertAllowedDomain(database: DatabaseClient, widgetId: string, domain: string): Promise<void> {
  const values = {
    widget_id: widgetId,
    domain,
    enabled: true,
  } satisfies Insertable<DatabaseSchema['allowed_domains']>;

  await database
    .insertInto('allowed_domains')
    .values(values)
    .onConflict((oc) => oc.columns(['widget_id', 'domain']).doUpdateSet({
      enabled: true,
    }))
    .executeTakeFirstOrThrow();
}
