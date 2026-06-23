import type { DatabaseClient } from './db.ts';

export type PublicWidget = {
  id: string;
  siteId: string;
  publicKey: string;
};

export type PublicWidgetLookupResult =
  | {
      status: 'found';
      widget: PublicWidget;
    }
  | {
      status: 'not_found';
    }
  | {
      status: 'disabled';
      reason: 'widget_disabled' | 'site_disabled';
    };

type PublicWidgetLookupRow = {
  widgetId: string;
  siteId: string;
  publicKey: string;
  widgetEnabled: boolean;
  siteEnabled: boolean;
};

export async function findWidgetByPublicKey(
  database: DatabaseClient,
  publicKey: string,
): Promise<PublicWidgetLookupResult> {
  const row = await database
    .selectFrom('widgets')
    .innerJoin('sites', 'sites.id', 'widgets.site_id')
    .select([
      'widgets.id as widgetId',
      'widgets.site_id as siteId',
      'widgets.public_key as publicKey',
      'widgets.enabled as widgetEnabled',
      'sites.enabled as siteEnabled',
    ])
    .where('widgets.public_key', '=', publicKey)
    .executeTakeFirst();

  return toPublicWidgetLookupResult(row);
}

function toPublicWidgetLookupResult(row: PublicWidgetLookupRow | undefined): PublicWidgetLookupResult {
  if (!row) {
    return { status: 'not_found' };
  }

  if (!row.widgetEnabled) {
    return { status: 'disabled', reason: 'widget_disabled' };
  }

  if (!row.siteEnabled) {
    return { status: 'disabled', reason: 'site_disabled' };
  }

  return {
    status: 'found',
    widget: {
      id: row.widgetId,
      siteId: row.siteId,
      publicKey: row.publicKey,
    },
  };
}
