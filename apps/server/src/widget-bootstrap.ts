import type { FastifyInstance } from 'fastify';

import type { DatabaseClient } from './db.ts';
import { matchOriginToAllowedDomains, type AllowedDomainRecord } from './origin-domain.ts';
import { readPublicWidgetKey, type InvalidWidgetRequestErrorResponse } from './request-validation.ts';
import { findWidgetByPublicKey } from './widget-lookup.ts';

export type WidgetBootstrapRouteOptions = {
  database: DatabaseClient;
};

export type WidgetThemeMode = 'light' | 'dark' | 'system';
export type WidgetAccentToken = 'blue';
export type WidgetRadiusToken = 'md';
export type WidgetLauncherIconToken = 'message';

export type WidgetBootstrapConfig = {
  assistant: {
    displayName: string;
  };
  launcher: {
    label: string;
    icon: WidgetLauncherIconToken;
  };
  welcome: {
    title: string;
    subtitle: string;
  };
  theme: {
    colorMode: WidgetThemeMode;
    accent: WidgetAccentToken;
    radius: WidgetRadiusToken;
  };
};

export const DEFAULT_WIDGET_BOOTSTRAP_CONFIG = {
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
} as const satisfies WidgetBootstrapConfig;

export type WidgetBootstrapResponse = {
  widget: {
    publicKey: string;
  };
  origin: {
    hostname: string;
    domain: string;
  };
  config: WidgetBootstrapConfig;
};

export type WidgetBootstrapErrorResponse =
  | InvalidWidgetRequestErrorResponse
  | {
      error: 'widget_not_found';
    }
  | {
      error: 'widget_disabled';
      reason: 'widget_disabled' | 'site_disabled';
    }
  | {
      error: 'origin_not_allowed';
      reason: 'missing_origin' | 'invalid_origin' | 'domain_not_allowed';
    };

type WidgetBootstrapRoute = {
  Params: {
    publicKey: string;
  };
  Reply: WidgetBootstrapResponse | WidgetBootstrapErrorResponse;
};

export function registerWidgetBootstrapRoutes(app: FastifyInstance, options: WidgetBootstrapRouteOptions): void {
  app.get<WidgetBootstrapRoute>('/api/widgets/:publicKey/bootstrap', async (request, reply) => {
    const publicKey = readPublicWidgetKey(request.params);

    if (publicKey.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_widget_request', reason: publicKey.reason });
    }

    const widgetLookup = await findWidgetByPublicKey(options.database, publicKey.publicKey);

    if (widgetLookup.status === 'not_found') {
      return reply.status(404).send({ error: 'widget_not_found' });
    }

    if (widgetLookup.status === 'disabled') {
      return reply.status(403).send({ error: 'widget_disabled', reason: widgetLookup.reason });
    }

    const allowedDomains = await loadEnabledAllowedDomains(options.database, widgetLookup.widget.id);
    const originMatch = matchOriginToAllowedDomains(request.headers.origin, allowedDomains);

    if (!originMatch.allowed) {
      return reply.status(403).send({ error: 'origin_not_allowed', reason: originMatch.reason });
    }

    const config = await loadWidgetBootstrapConfig(options.database, widgetLookup.widget.id);

    return reply.send({
      widget: {
        publicKey: widgetLookup.widget.publicKey,
      },
      origin: {
        hostname: originMatch.hostname,
        domain: originMatch.domain,
      },
      config,
    });
  });
}

export async function loadEnabledAllowedDomains(
  database: DatabaseClient,
  widgetId: string,
): Promise<AllowedDomainRecord[]> {
  return database
    .selectFrom('allowed_domains')
    .select(['domain', 'enabled'])
    .where('widget_id', '=', widgetId)
    .where('enabled', '=', true)
    .execute();
}


export type WidgetBootstrapConfigRow = {
  assistant_display_name?: string | null;
  launcher_label?: string | null;
  launcher_icon?: string | null;
  welcome_title?: string | null;
  welcome_subtitle?: string | null;
  theme_color_mode?: string | null;
  theme_accent?: string | null;
  theme_radius?: string | null;
};

export async function loadWidgetBootstrapConfig(
  database: DatabaseClient,
  widgetId: string,
): Promise<WidgetBootstrapConfig> {
  const row = await database
    .selectFrom('widgets')
    .select([
      'assistant_display_name',
      'launcher_label',
      'launcher_icon',
      'welcome_title',
      'welcome_subtitle',
      'theme_color_mode',
      'theme_accent',
      'theme_radius',
    ])
    .where('id', '=', widgetId)
    .executeTakeFirst() as WidgetBootstrapConfigRow | undefined;

  return toWidgetBootstrapConfig(row);
}

export function toWidgetBootstrapConfig(row: WidgetBootstrapConfigRow | undefined): WidgetBootstrapConfig {
  return {
    assistant: {
      displayName: readPlainText(row?.assistant_display_name, DEFAULT_WIDGET_BOOTSTRAP_CONFIG.assistant.displayName),
    },
    launcher: {
      label: readPlainText(row?.launcher_label, DEFAULT_WIDGET_BOOTSTRAP_CONFIG.launcher.label),
      icon: row?.launcher_icon === 'message' ? row.launcher_icon : DEFAULT_WIDGET_BOOTSTRAP_CONFIG.launcher.icon,
    },
    welcome: {
      title: readPlainText(row?.welcome_title, DEFAULT_WIDGET_BOOTSTRAP_CONFIG.welcome.title),
      subtitle: readPlainText(row?.welcome_subtitle, DEFAULT_WIDGET_BOOTSTRAP_CONFIG.welcome.subtitle),
    },
    theme: {
      colorMode: isWidgetThemeMode(row?.theme_color_mode)
        ? row.theme_color_mode
        : DEFAULT_WIDGET_BOOTSTRAP_CONFIG.theme.colorMode,
      accent: row?.theme_accent === 'blue' ? row.theme_accent : DEFAULT_WIDGET_BOOTSTRAP_CONFIG.theme.accent,
      radius: row?.theme_radius === 'md' ? row.theme_radius : DEFAULT_WIDGET_BOOTSTRAP_CONFIG.theme.radius,
    },
  };
}

function readPlainText(value: string | null | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function isWidgetThemeMode(value: string | null | undefined): value is WidgetThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}
