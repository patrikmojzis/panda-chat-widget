import type { FastifyInstance } from 'fastify';
import { sql, type Insertable, type Updateable } from 'kysely';

import {
  requireAuthenticatedApi,
  requireUnsafeRequestCsrf,
  setNoStore,
  type AuthErrorResponse,
  type CsrfErrorResponse,
} from './auth-guard.ts';
import type { DatabaseClient, DatabaseSchema, PandaDeliveryIntentStatus } from './db.ts';
import { normalizeAllowedDomainInput, type AllowedDomainInputInvalidReason } from './origin-domain.ts';
import {
  toWidgetBootstrapConfig,
  type WidgetBootstrapConfig,
  type WidgetBootstrapConfigRow,
} from './widget-bootstrap.ts';

export type ConsoleWidgetSettingsRouteOptions = {
  database: DatabaseClient;
};

export type ConsoleSettingsWidget = {
  id: string;
  siteId: string;
  publicKey: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConsoleAllowedDomain = {
  id: string;
  widgetId: string;
  domain: string;
  enabled: boolean;
  createdAt: string;
};

export type ConsoleWidgetConnectionStatus = 'not_configured' | 'configured_placeholder';

export type ConsoleWidgetLocalDelivery = {
  queuedIntentCount: number;
  lastQueuedAt: string | null;
  claimedIntentCount: number;
  lastClaimedAt: string | null;
  appliedLocalReplyCount: number;
  lastAppliedLocalReplyAt: string | null;
  nextLocalReplyCandidate: ConsoleWidgetNextLocalReplyCandidate | null;
};

export type ConsoleWidgetNextLocalReplyCandidate = {
  id: string;
  status: PandaDeliveryIntentStatus;
  conversationId: string;
  visitorMessageId: string;
  clientMessageId: string;
  createdAt: string;
  claimedAt: string | null;
};

export type ConsoleWidgetConnection = {
  status: ConsoleWidgetConnectionStatus;
  routeHandle: string | null;
  localDelivery: ConsoleWidgetLocalDelivery;
};

export type ConsoleWidgetSettingsResponse = {
  widget: ConsoleSettingsWidget;
  config: WidgetBootstrapConfig;
  connection: ConsoleWidgetConnection;
  install: {
    snippetAvailable: boolean;
    snippet: string | null;
  };
};

export type ConsoleAllowedDomainListResponse = {
  domains: ConsoleAllowedDomain[];
};

export type ConsoleAllowedDomainResponse = {
  domain: ConsoleAllowedDomain;
};

type WidgetRouteParams = {
  siteId: string;
  widgetId: string;
};

type DomainRouteParams = WidgetRouteParams & {
  domainId: string;
};

type WidgetSettingsReadRoute = {
  Params: WidgetRouteParams;
  Reply: ConsoleWidgetSettingsResponse | ConsoleWidgetSettingsErrorResponse;
};

type WidgetSettingsUpdateRoute = {
  Params: WidgetRouteParams;
  Body: unknown;
  Reply: ConsoleWidgetSettingsResponse | ConsoleWidgetSettingsErrorResponse;
};

type DomainListRoute = {
  Params: WidgetRouteParams;
  Reply: ConsoleAllowedDomainListResponse | ConsoleAllowedDomainErrorResponse;
};

type DomainCreateRoute = {
  Params: WidgetRouteParams;
  Body: unknown;
  Reply: ConsoleAllowedDomainResponse | ConsoleAllowedDomainErrorResponse;
};

type DomainDeleteRoute = {
  Params: DomainRouteParams;
  Reply: ConsoleAllowedDomainErrorResponse | null;
};

type ConsoleWidgetSettingsErrorResponse =
  | AuthErrorResponse
  | CsrfErrorResponse
  | {
      error: 'invalid_widget_settings_request';
      reason: InvalidWidgetSettingsRequestReason;
    }
  | {
      error: 'widget_not_found';
    };

type ConsoleAllowedDomainErrorResponse =
  | AuthErrorResponse
  | CsrfErrorResponse
  | {
      error: 'invalid_domain_request';
      reason: InvalidDomainRequestReason;
    }
  | {
      error: 'widget_not_found';
    }
  | {
      error: 'domain_not_found';
    };

type InvalidWidgetSettingsRequestReason =
  | 'missing_site_id'
  | 'invalid_site_id'
  | 'missing_widget_id'
  | 'invalid_widget_id'
  | 'invalid_body'
  | 'unknown_field'
  | 'missing_update'
  | 'missing_name'
  | 'invalid_name'
  | 'missing_display_name'
  | 'invalid_display_name'
  | 'missing_launcher_label'
  | 'invalid_launcher_label'
  | 'invalid_launcher_icon'
  | 'missing_welcome_title'
  | 'invalid_welcome_title'
  | 'missing_welcome_subtitle'
  | 'invalid_welcome_subtitle'
  | 'invalid_theme_color_mode'
  | 'invalid_theme_accent'
  | 'invalid_theme_radius'
  | 'missing_route_handle'
  | 'invalid_route_handle';

type InvalidDomainRequestReason =
  | 'missing_site_id'
  | 'invalid_site_id'
  | 'missing_widget_id'
  | 'invalid_widget_id'
  | 'missing_domain_id'
  | 'invalid_domain_id'
  | AllowedDomainInputInvalidReason;

type IdReadResult =
  | {
      status: 'valid';
      siteId: string;
      widgetId: string;
    }
  | {
      status: 'invalid';
      reason: 'missing_site_id' | 'invalid_site_id' | 'missing_widget_id' | 'invalid_widget_id';
    };

type DomainIdReadResult =
  | {
      status: 'valid';
      siteId: string;
      widgetId: string;
      domainId: string;
    }
  | {
      status: 'invalid';
      reason: InvalidDomainRequestReason;
    };

type SettingsPatchParseResult =
  | {
      status: 'valid';
      updates: Updateable<DatabaseSchema['widgets']>;
    }
  | {
      status: 'invalid';
      reason: InvalidWidgetSettingsRequestReason;
    };

type DomainCreateParseResult =
  | {
      status: 'valid';
      domain: string;
    }
  | {
      status: 'invalid';
      reason: InvalidDomainRequestReason;
    };

type WidgetSettingsRow = WidgetBootstrapConfigRow & {
  id: string;
  site_id: string;
  public_key: string;
  panda_route_handle?: string | null;
  name: string;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type AllowedDomainRow = {
  id: string;
  widget_id: string;
  domain: string;
  enabled: boolean;
  created_at: Date | string;
};

type LocalDeliveryStatusRow = {
  queued_intent_count: string | number | bigint;
  last_queued_at: Date | string | null;
  claimed_intent_count: string | number | bigint;
  last_claimed_at: Date | string | null;
};

type AppliedLocalReplyStatusRow = {
  applied_local_reply_count: string | number | bigint;
  last_applied_local_reply_at: Date | string | null;
};

type LocalReplyCandidateRow = {
  id: string;
  status: PandaDeliveryIntentStatus;
  conversation_id: string;
  visitor_message_id: string;
  client_message_id: string;
  created_at: Date | string;
  claimed_at: Date | string | null;
};

type DomainCreateBody = {
  domain?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MAX_LENGTH = 100;
const DISPLAY_NAME_MAX_LENGTH = 100;
const LAUNCHER_LABEL_MAX_LENGTH = 100;
const WELCOME_TITLE_MAX_LENGTH = 120;
const WELCOME_SUBTITLE_MAX_LENGTH = 240;
const ROUTE_HANDLE_MAX_LENGTH = 200;

const SETTINGS_TOP_LEVEL_KEYS = new Set(['name', 'config', 'connection']);
const CONFIG_SECTION_KEYS = new Set(['assistant', 'launcher', 'welcome', 'theme']);
const ASSISTANT_KEYS = new Set(['displayName']);
const LAUNCHER_KEYS = new Set(['label', 'icon']);
const WELCOME_KEYS = new Set(['title', 'subtitle']);
const THEME_KEYS = new Set(['colorMode', 'accent', 'radius']);
const CONNECTION_KEYS = new Set(['routeHandle']);

export function registerConsoleWidgetSettingsRoutes(
  app: FastifyInstance,
  options: ConsoleWidgetSettingsRouteOptions,
): void {
  app.get<WidgetSettingsReadRoute>('/api/console/sites/:siteId/widgets/:widgetId/settings', async (request, reply) => {
    setNoStore(reply);
    const auth = await requireAuthenticatedApi(options.database, request, reply);

    if (!auth) {
      return;
    }

    const ids = readWidgetRouteIds(request.params);

    if (ids.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_widget_settings_request', reason: ids.reason });
    }

    const settings = await getConsoleWidgetSettings(options.database, {
      workspaceId: auth.workspace.id,
      siteId: ids.siteId,
      widgetId: ids.widgetId,
    });

    if (!settings) {
      return reply.status(404).send({ error: 'widget_not_found' });
    }

    return reply.send(settings);
  });

  app.patch<WidgetSettingsUpdateRoute>('/api/console/sites/:siteId/widgets/:widgetId/settings', async (request, reply) => {
    setNoStore(reply);
    const auth = await requireAuthenticatedApi(options.database, request, reply);

    if (!auth) {
      return;
    }

    if (!(await requireUnsafeRequestCsrf(request, reply))) {
      return;
    }

    const ids = readWidgetRouteIds(request.params);

    if (ids.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_widget_settings_request', reason: ids.reason });
    }

    const patch = parseWidgetSettingsPatch(request.body);

    if (patch.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_widget_settings_request', reason: patch.reason });
    }

    const updated = await updateConsoleWidgetSettings(options.database, {
      workspaceId: auth.workspace.id,
      siteId: ids.siteId,
      widgetId: ids.widgetId,
      updates: patch.updates,
    });

    if (!updated) {
      return reply.status(404).send({ error: 'widget_not_found' });
    }

    return reply.send(updated);
  });

  app.get<DomainListRoute>('/api/console/sites/:siteId/widgets/:widgetId/domains', async (request, reply) => {
    setNoStore(reply);
    const auth = await requireAuthenticatedApi(options.database, request, reply);

    if (!auth) {
      return;
    }

    const ids = readWidgetRouteIds(request.params);

    if (ids.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_domain_request', reason: ids.reason });
    }

    const widget = await findOwnedWidgetSettingsRow(options.database, {
      workspaceId: auth.workspace.id,
      siteId: ids.siteId,
      widgetId: ids.widgetId,
    });

    if (!widget) {
      return reply.status(404).send({ error: 'widget_not_found' });
    }

    return reply.send({ domains: await listConsoleAllowedDomains(options.database, widget.id) });
  });

  app.post<DomainCreateRoute>('/api/console/sites/:siteId/widgets/:widgetId/domains', async (request, reply) => {
    setNoStore(reply);
    const auth = await requireAuthenticatedApi(options.database, request, reply);

    if (!auth) {
      return;
    }

    if (!(await requireUnsafeRequestCsrf(request, reply))) {
      return;
    }

    const ids = readWidgetRouteIds(request.params);

    if (ids.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_domain_request', reason: ids.reason });
    }

    const domainRequest = parseDomainCreateBody(request.body);

    if (domainRequest.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_domain_request', reason: domainRequest.reason });
    }

    const widget = await findOwnedWidgetSettingsRow(options.database, {
      workspaceId: auth.workspace.id,
      siteId: ids.siteId,
      widgetId: ids.widgetId,
    });

    if (!widget) {
      return reply.status(404).send({ error: 'widget_not_found' });
    }

    const domain = await upsertConsoleAllowedDomain(options.database, {
      widgetId: widget.id,
      domain: domainRequest.domain,
    });

    return reply.status(201).send({ domain });
  });

  app.delete<DomainDeleteRoute>('/api/console/sites/:siteId/widgets/:widgetId/domains/:domainId', async (request, reply) => {
    setNoStore(reply);
    const auth = await requireAuthenticatedApi(options.database, request, reply);

    if (!auth) {
      return;
    }

    if (!(await requireUnsafeRequestCsrf(request, reply))) {
      return;
    }

    const ids = readDomainRouteIds(request.params);

    if (ids.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_domain_request', reason: ids.reason });
    }

    const widget = await findOwnedWidgetSettingsRow(options.database, {
      workspaceId: auth.workspace.id,
      siteId: ids.siteId,
      widgetId: ids.widgetId,
    });

    if (!widget) {
      return reply.status(404).send({ error: 'widget_not_found' });
    }

    const deleted = await deleteConsoleAllowedDomain(options.database, {
      widgetId: widget.id,
      domainId: ids.domainId,
    });

    if (!deleted) {
      return reply.status(404).send({ error: 'domain_not_found' });
    }

    return reply.status(204).send(null);
  });
}

export async function getConsoleWidgetSettings(
  database: DatabaseClient,
  input: { workspaceId: string; siteId: string; widgetId: string },
): Promise<ConsoleWidgetSettingsResponse | null> {
  const widget = await findOwnedWidgetSettingsRow(database, input);

  if (!widget) {
    return null;
  }

  return toConsoleWidgetSettingsResponse(database, widget);
}

export async function updateConsoleWidgetSettings(
  database: DatabaseClient,
  input: {
    workspaceId: string;
    siteId: string;
    widgetId: string;
    updates: Updateable<DatabaseSchema['widgets']>;
    now?: Date;
  },
): Promise<ConsoleWidgetSettingsResponse | null> {
  const widget = await findOwnedWidgetSettingsRow(database, input);

  if (!widget) {
    return null;
  }

  await database
    .updateTable('widgets')
    .set({
      ...input.updates,
      updated_at: input.now ?? new Date(),
    })
    .where('id', '=', widget.id)
    .where('site_id', '=', input.siteId)
    .execute();

  return getConsoleWidgetSettings(database, input);
}

export async function listConsoleAllowedDomains(
  database: DatabaseClient,
  widgetId: string,
): Promise<ConsoleAllowedDomain[]> {
  const rows = (await database
    .selectFrom('allowed_domains')
    .select(['id', 'widget_id', 'domain', 'enabled', 'created_at'])
    .where('widget_id', '=', widgetId)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute()) as AllowedDomainRow[];

  return rows.map(toConsoleAllowedDomain);
}

export async function upsertConsoleAllowedDomain(
  database: DatabaseClient,
  input: { widgetId: string; domain: string; now?: Date },
): Promise<ConsoleAllowedDomain> {
  const values = {
    widget_id: input.widgetId,
    domain: input.domain,
    enabled: true,
    created_at: input.now ?? new Date(),
  } satisfies Insertable<DatabaseSchema['allowed_domains']>;

  const row = (await database
    .insertInto('allowed_domains')
    .values(values)
    .onConflict((oc) => oc.columns(['widget_id', 'domain']).doUpdateSet({ enabled: true }))
    .returning(['id', 'widget_id', 'domain', 'enabled', 'created_at'])
    .executeTakeFirstOrThrow()) as AllowedDomainRow;

  return toConsoleAllowedDomain(row);
}

export async function deleteConsoleAllowedDomain(
  database: DatabaseClient,
  input: { widgetId: string; domainId: string },
): Promise<boolean> {
  const deleted = await database
    .deleteFrom('allowed_domains')
    .where('id', '=', input.domainId)
    .where('widget_id', '=', input.widgetId)
    .returning('id')
    .executeTakeFirst();

  return Boolean(deleted);
}

export function createInstallSnippet(publicKey: string): string {
  return `<script src="/vendor/panda-chat-widget-loader.js" data-public-key="${escapeHtmlAttribute(publicKey)}" async></script>`;
}

function readWidgetRouteIds(params: unknown): IdReadResult {
  if (!isRecord(params) || !('siteId' in params)) {
    return { status: 'invalid', reason: 'missing_site_id' };
  }

  const siteId = readUuidValue(params.siteId, 'missing_site_id', 'invalid_site_id');

  if (siteId.status === 'invalid') {
    return { status: 'invalid', reason: siteId.reason };
  }

  if (!('widgetId' in params)) {
    return { status: 'invalid', reason: 'missing_widget_id' };
  }

  const widgetId = readUuidValue(params.widgetId, 'missing_widget_id', 'invalid_widget_id');

  if (widgetId.status === 'invalid') {
    return { status: 'invalid', reason: widgetId.reason };
  }

  return { status: 'valid', siteId: siteId.id, widgetId: widgetId.id };
}

function readDomainRouteIds(params: unknown): DomainIdReadResult {
  const ids = readWidgetRouteIds(params);

  if (ids.status === 'invalid') {
    return ids;
  }

  if (!isRecord(params) || !('domainId' in params)) {
    return { status: 'invalid', reason: 'missing_domain_id' };
  }

  const domainId = readUuidValue(params.domainId, 'missing_domain_id', 'invalid_domain_id');

  if (domainId.status === 'invalid') {
    return { status: 'invalid', reason: domainId.reason };
  }

  return { status: 'valid', siteId: ids.siteId, widgetId: ids.widgetId, domainId: domainId.id };
}

function readUuidValue<TMissing extends string, TInvalid extends string>(
  value: unknown,
  missingReason: TMissing,
  invalidReason: TInvalid,
):
  | {
      status: 'valid';
      id: string;
    }
  | {
      status: 'invalid';
      reason: TMissing | TInvalid;
    } {
  if (typeof value !== 'string') {
    return { status: 'invalid', reason: invalidReason };
  }

  const id = value.trim();

  if (!id) {
    return { status: 'invalid', reason: missingReason };
  }

  if (!UUID_PATTERN.test(id)) {
    return { status: 'invalid', reason: invalidReason };
  }

  return { status: 'valid', id };
}

function parseDomainCreateBody(body: unknown): DomainCreateParseResult {
  if (!isRecord(body) || !('domain' in body)) {
    return { status: 'invalid', reason: 'missing_domain' };
  }

  const domain = normalizeAllowedDomainInput((body as DomainCreateBody).domain);

  return domain.status === 'valid'
    ? { status: 'valid', domain: domain.domain }
    : { status: 'invalid', reason: domain.reason };
}

function parseWidgetSettingsPatch(body: unknown): SettingsPatchParseResult {
  if (!isRecord(body)) {
    return { status: 'invalid', reason: 'invalid_body' };
  }

  if (hasUnknownKeys(body, SETTINGS_TOP_LEVEL_KEYS)) {
    return { status: 'invalid', reason: 'unknown_field' };
  }

  const updates: Updateable<DatabaseSchema['widgets']> = {};
  let hasUpdate = false;

  if ('name' in body) {
    const name = readPlainTextField(body.name, NAME_MAX_LENGTH, 'missing_name', 'invalid_name');

    if (name.status === 'invalid') {
      return { status: 'invalid', reason: name.reason };
    }

    updates.name = name.value;
    hasUpdate = true;
  }

  if ('config' in body) {
    if (!isRecord(body.config)) {
      return { status: 'invalid', reason: 'invalid_body' };
    }

    if (hasUnknownKeys(body.config, CONFIG_SECTION_KEYS)) {
      return { status: 'invalid', reason: 'unknown_field' };
    }

    const configUpdates = readConfigUpdates(body.config);

    if (configUpdates.status === 'invalid') {
      return configUpdates;
    }

    Object.assign(updates, configUpdates.updates);
    hasUpdate = hasUpdate || configUpdates.hasUpdate;
  }

  if ('connection' in body) {
    if (!isRecord(body.connection) || hasUnknownKeys(body.connection, CONNECTION_KEYS)) {
      return { status: 'invalid', reason: isRecord(body.connection) ? 'unknown_field' : 'invalid_body' };
    }

    const connectionUpdates = readConnectionUpdates(body.connection);

    if (connectionUpdates.status === 'invalid') {
      return connectionUpdates;
    }

    Object.assign(updates, connectionUpdates.updates);
    hasUpdate = hasUpdate || connectionUpdates.hasUpdate;
  }

  if (!hasUpdate) {
    return { status: 'invalid', reason: 'missing_update' };
  }

  return { status: 'valid', updates };
}

function readConfigUpdates(config: Record<string, unknown>):
  | {
      status: 'valid';
      updates: Updateable<DatabaseSchema['widgets']>;
      hasUpdate: boolean;
    }
  | {
      status: 'invalid';
      reason: InvalidWidgetSettingsRequestReason;
    } {
  const updates: Updateable<DatabaseSchema['widgets']> = {};
  let hasUpdate = false;

  if ('assistant' in config) {
    if (!isRecord(config.assistant) || hasUnknownKeys(config.assistant, ASSISTANT_KEYS)) {
      return { status: 'invalid', reason: isRecord(config.assistant) ? 'unknown_field' : 'invalid_body' };
    }

    if ('displayName' in config.assistant) {
      const displayName = readPlainTextField(
        config.assistant.displayName,
        DISPLAY_NAME_MAX_LENGTH,
        'missing_display_name',
        'invalid_display_name',
      );

      if (displayName.status === 'invalid') {
        return { status: 'invalid', reason: displayName.reason };
      }

      updates.assistant_display_name = displayName.value;
      hasUpdate = true;
    }
  }

  if ('launcher' in config) {
    if (!isRecord(config.launcher) || hasUnknownKeys(config.launcher, LAUNCHER_KEYS)) {
      return { status: 'invalid', reason: isRecord(config.launcher) ? 'unknown_field' : 'invalid_body' };
    }

    if ('label' in config.launcher) {
      const label = readPlainTextField(
        config.launcher.label,
        LAUNCHER_LABEL_MAX_LENGTH,
        'missing_launcher_label',
        'invalid_launcher_label',
      );

      if (label.status === 'invalid') {
        return { status: 'invalid', reason: label.reason };
      }

      updates.launcher_label = label.value;
      hasUpdate = true;
    }

    if ('icon' in config.launcher) {
      if (config.launcher.icon !== 'message') {
        return { status: 'invalid', reason: 'invalid_launcher_icon' };
      }

      updates.launcher_icon = config.launcher.icon;
      hasUpdate = true;
    }
  }

  if ('welcome' in config) {
    if (!isRecord(config.welcome) || hasUnknownKeys(config.welcome, WELCOME_KEYS)) {
      return { status: 'invalid', reason: isRecord(config.welcome) ? 'unknown_field' : 'invalid_body' };
    }

    if ('title' in config.welcome) {
      const title = readPlainTextField(
        config.welcome.title,
        WELCOME_TITLE_MAX_LENGTH,
        'missing_welcome_title',
        'invalid_welcome_title',
      );

      if (title.status === 'invalid') {
        return { status: 'invalid', reason: title.reason };
      }

      updates.welcome_title = title.value;
      hasUpdate = true;
    }

    if ('subtitle' in config.welcome) {
      const subtitle = readPlainTextField(
        config.welcome.subtitle,
        WELCOME_SUBTITLE_MAX_LENGTH,
        'missing_welcome_subtitle',
        'invalid_welcome_subtitle',
      );

      if (subtitle.status === 'invalid') {
        return { status: 'invalid', reason: subtitle.reason };
      }

      updates.welcome_subtitle = subtitle.value;
      hasUpdate = true;
    }
  }

  if ('theme' in config) {
    if (!isRecord(config.theme) || hasUnknownKeys(config.theme, THEME_KEYS)) {
      return { status: 'invalid', reason: isRecord(config.theme) ? 'unknown_field' : 'invalid_body' };
    }

    if ('colorMode' in config.theme) {
      if (config.theme.colorMode !== 'light' && config.theme.colorMode !== 'dark' && config.theme.colorMode !== 'system') {
        return { status: 'invalid', reason: 'invalid_theme_color_mode' };
      }

      updates.theme_color_mode = config.theme.colorMode;
      hasUpdate = true;
    }

    if ('accent' in config.theme) {
      if (config.theme.accent !== 'blue') {
        return { status: 'invalid', reason: 'invalid_theme_accent' };
      }

      updates.theme_accent = config.theme.accent;
      hasUpdate = true;
    }

    if ('radius' in config.theme) {
      if (config.theme.radius !== 'md') {
        return { status: 'invalid', reason: 'invalid_theme_radius' };
      }

      updates.theme_radius = config.theme.radius;
      hasUpdate = true;
    }
  }

  return { status: 'valid', updates, hasUpdate };
}


function readConnectionUpdates(connection: Record<string, unknown>):
  | {
      status: 'valid';
      updates: Updateable<DatabaseSchema['widgets']>;
      hasUpdate: boolean;
    }
  | {
      status: 'invalid';
      reason: InvalidWidgetSettingsRequestReason;
    } {
  const updates: Updateable<DatabaseSchema['widgets']> = {};

  if (!('routeHandle' in connection)) {
    return { status: 'valid', updates, hasUpdate: false };
  }

  const routeHandle = readRouteHandleField(connection.routeHandle);

  if (routeHandle.status === 'invalid') {
    return { status: 'invalid', reason: routeHandle.reason };
  }

  updates.panda_route_handle = routeHandle.value;

  return { status: 'valid', updates, hasUpdate: true };
}

function readRouteHandleField(value: unknown):
  | {
      status: 'valid';
      value: string | null;
    }
  | {
      status: 'invalid';
      reason: InvalidWidgetSettingsRequestReason;
    } {
  if (value === null) {
    return { status: 'valid', value: null };
  }

  if (typeof value !== 'string') {
    return { status: 'invalid', reason: 'invalid_route_handle' };
  }

  const routeHandle = value.trim();

  if (!routeHandle) {
    return { status: 'invalid', reason: 'missing_route_handle' };
  }

  if (routeHandle.length > ROUTE_HANDLE_MAX_LENGTH || /[<>]/.test(routeHandle)) {
    return { status: 'invalid', reason: 'invalid_route_handle' };
  }

  return { status: 'valid', value: routeHandle };
}

function readPlainTextField(
  value: unknown,
  maxLength: number,
  missingReason: InvalidWidgetSettingsRequestReason,
  invalidReason: InvalidWidgetSettingsRequestReason,
):
  | {
      status: 'valid';
      value: string;
    }
  | {
      status: 'invalid';
      reason: InvalidWidgetSettingsRequestReason;
    } {
  if (typeof value !== 'string') {
    return { status: 'invalid', reason: invalidReason };
  }

  const text = value.trim();

  if (!text) {
    return { status: 'invalid', reason: missingReason };
  }

  if (text.length > maxLength || /[<>]/.test(text)) {
    return { status: 'invalid', reason: invalidReason };
  }

  return { status: 'valid', value: text };
}

function hasUnknownKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(value).some((key) => !allowedKeys.has(key));
}

async function findOwnedWidgetSettingsRow(
  database: DatabaseClient,
  input: { workspaceId: string; siteId: string; widgetId: string },
): Promise<WidgetSettingsRow | null> {
  const row = (await database
    .selectFrom('widgets')
    .innerJoin('sites', 'sites.id', 'widgets.site_id')
    .select([
      'widgets.id as id',
      'widgets.site_id as site_id',
      'widgets.public_key as public_key',
      'widgets.panda_route_handle as panda_route_handle',
      'widgets.name as name',
      'widgets.assistant_display_name as assistant_display_name',
      'widgets.launcher_label as launcher_label',
      'widgets.launcher_icon as launcher_icon',
      'widgets.welcome_title as welcome_title',
      'widgets.welcome_subtitle as welcome_subtitle',
      'widgets.theme_color_mode as theme_color_mode',
      'widgets.theme_accent as theme_accent',
      'widgets.theme_radius as theme_radius',
      'widgets.enabled as enabled',
      'widgets.created_at as created_at',
      'widgets.updated_at as updated_at',
    ])
    .where('sites.id', '=', input.siteId)
    .where('sites.workspace_id', '=', input.workspaceId)
    .where('widgets.id', '=', input.widgetId)
    .where('widgets.site_id', '=', input.siteId)
    .executeTakeFirst()) as WidgetSettingsRow | undefined;

  return row ?? null;
}

async function toConsoleWidgetSettingsResponse(
  database: DatabaseClient,
  row: WidgetSettingsRow,
): Promise<ConsoleWidgetSettingsResponse> {
  const hasEnabledDomain = Boolean(await database
    .selectFrom('allowed_domains')
    .select('id')
    .where('widget_id', '=', row.id)
    .where('enabled', '=', true)
    .limit(1)
    .executeTakeFirst());
  const localDelivery = await readConsoleWidgetLocalDelivery(database, row.id);

  return {
    widget: toConsoleSettingsWidget(row),
    config: toWidgetBootstrapConfig(row),
    connection: toConsoleWidgetConnection(row, localDelivery),
    install: {
      snippetAvailable: hasEnabledDomain,
      snippet: hasEnabledDomain ? createInstallSnippet(row.public_key) : null,
    },
  };
}

async function readConsoleWidgetLocalDelivery(
  database: DatabaseClient,
  widgetId: string,
): Promise<ConsoleWidgetLocalDelivery> {
  const row = (await database
    .selectFrom('panda_delivery_intents')
    .select((eb) => [
      eb.fn.count<string | number | bigint>('id').filterWhere('status', '=', 'queued').as('queued_intent_count'),
      eb.fn.max<Date | string | null>('created_at').filterWhere('status', '=', 'queued').as('last_queued_at'),
      eb.fn.count<string | number | bigint>('id').filterWhere('status', '=', 'claimed').as('claimed_intent_count'),
      eb.fn.max<Date | string | null>('claimed_at').filterWhere('status', '=', 'claimed').as('last_claimed_at'),
    ])
    .where('widget_id', '=', widgetId)
    .executeTakeFirst()) as LocalDeliveryStatusRow | undefined;
  const [appliedLocalReplies, nextLocalReplyCandidate] = await Promise.all([
    readConsoleWidgetAppliedLocalReplies(database, widgetId),
    readConsoleWidgetNextLocalReplyCandidate(database, widgetId),
  ]);

  return {
    queuedIntentCount: toCountNumber(row?.queued_intent_count),
    lastQueuedAt: row?.last_queued_at ? toIsoString(row.last_queued_at) : null,
    claimedIntentCount: toCountNumber(row?.claimed_intent_count),
    lastClaimedAt: row?.last_claimed_at ? toIsoString(row.last_claimed_at) : null,
    ...appliedLocalReplies,
    nextLocalReplyCandidate,
  };
}

async function readConsoleWidgetAppliedLocalReplies(
  database: DatabaseClient,
  widgetId: string,
): Promise<Pick<ConsoleWidgetLocalDelivery, 'appliedLocalReplyCount' | 'lastAppliedLocalReplyAt'>> {
  const row = (await database
    .selectFrom('panda_delivery_intents')
    .innerJoin('conversations', (join) =>
      join
        .onRef('conversations.id', '=', 'panda_delivery_intents.conversation_id')
        .onRef('conversations.widget_id', '=', 'panda_delivery_intents.widget_id'),
    )
    .innerJoin('messages', (join) =>
      join.onRef('messages.conversation_id', '=', 'panda_delivery_intents.conversation_id'),
    )
    .select((eb) => [
      eb.fn.count<string | number | bigint>('messages.id').as('applied_local_reply_count'),
      eb.fn.max<Date | string | null>('messages.created_at').as('last_applied_local_reply_at'),
    ])
    .where('panda_delivery_intents.widget_id', '=', widgetId)
    .where('messages.sender', '=', 'agent')
    .where('messages.client_message_id', '=', sql<string>`'local-panda-reply-v1:' || panda_delivery_intents.id::text`)
    .executeTakeFirst()) as AppliedLocalReplyStatusRow | undefined;

  return {
    appliedLocalReplyCount: toCountNumber(row?.applied_local_reply_count),
    lastAppliedLocalReplyAt: row?.last_applied_local_reply_at ? toIsoString(row.last_applied_local_reply_at) : null,
  };
}

async function readConsoleWidgetNextLocalReplyCandidate(
  database: DatabaseClient,
  widgetId: string,
): Promise<ConsoleWidgetNextLocalReplyCandidate | null> {
  const claimedUnapplied = await readConsoleWidgetOldestClaimedUnappliedIntent(database, widgetId);

  return claimedUnapplied ?? readConsoleWidgetOldestQueuedIntent(database, widgetId);
}

async function readConsoleWidgetOldestClaimedUnappliedIntent(
  database: DatabaseClient,
  widgetId: string,
): Promise<ConsoleWidgetNextLocalReplyCandidate | null> {
  const row = (await database
    .selectFrom('panda_delivery_intents')
    .innerJoin('conversations', (join) =>
      join
        .onRef('conversations.id', '=', 'panda_delivery_intents.conversation_id')
        .onRef('conversations.widget_id', '=', 'panda_delivery_intents.widget_id'),
    )
    .select([
      'panda_delivery_intents.id as id',
      'panda_delivery_intents.status as status',
      'conversations.id as conversation_id',
      'panda_delivery_intents.visitor_message_id as visitor_message_id',
      'panda_delivery_intents.client_message_id as client_message_id',
      'panda_delivery_intents.created_at as created_at',
      'panda_delivery_intents.claimed_at as claimed_at',
    ])
    .where('panda_delivery_intents.widget_id', '=', widgetId)
    .where('panda_delivery_intents.status', '=', 'claimed')
    .where('panda_delivery_intents.claimed_at', 'is not', null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('messages')
            .select('messages.id')
            .whereRef('messages.conversation_id', '=', 'panda_delivery_intents.conversation_id')
            .where('messages.sender', '=', 'agent')
            .where('messages.client_message_id', '=', sql<string>`'local-panda-reply-v1:' || panda_delivery_intents.id::text`),
        ),
      ),
    )
    .orderBy('panda_delivery_intents.claimed_at', 'asc')
    .orderBy('panda_delivery_intents.created_at', 'asc')
    .orderBy('panda_delivery_intents.id', 'asc')
    .limit(1)
    .executeTakeFirst()) as LocalReplyCandidateRow | undefined;

  return row ? toConsoleWidgetNextLocalReplyCandidate(row) : null;
}

async function readConsoleWidgetOldestQueuedIntent(
  database: DatabaseClient,
  widgetId: string,
): Promise<ConsoleWidgetNextLocalReplyCandidate | null> {
  const row = (await database
    .selectFrom('panda_delivery_intents')
    .innerJoin('conversations', (join) =>
      join
        .onRef('conversations.id', '=', 'panda_delivery_intents.conversation_id')
        .onRef('conversations.widget_id', '=', 'panda_delivery_intents.widget_id'),
    )
    .select([
      'panda_delivery_intents.id as id',
      'panda_delivery_intents.status as status',
      'conversations.id as conversation_id',
      'panda_delivery_intents.visitor_message_id as visitor_message_id',
      'panda_delivery_intents.client_message_id as client_message_id',
      'panda_delivery_intents.created_at as created_at',
      'panda_delivery_intents.claimed_at as claimed_at',
    ])
    .where('panda_delivery_intents.widget_id', '=', widgetId)
    .where('panda_delivery_intents.status', '=', 'queued')
    .orderBy('panda_delivery_intents.created_at', 'asc')
    .orderBy('panda_delivery_intents.id', 'asc')
    .limit(1)
    .executeTakeFirst()) as LocalReplyCandidateRow | undefined;

  return row ? toConsoleWidgetNextLocalReplyCandidate(row) : null;
}

function toConsoleWidgetNextLocalReplyCandidate(row: LocalReplyCandidateRow): ConsoleWidgetNextLocalReplyCandidate {
  return {
    id: row.id,
    status: row.status,
    conversationId: row.conversation_id,
    visitorMessageId: row.visitor_message_id,
    clientMessageId: row.client_message_id,
    createdAt: toIsoString(row.created_at),
    claimedAt: row.claimed_at ? toIsoString(row.claimed_at) : null,
  };
}

function toConsoleWidgetConnection(
  row: WidgetSettingsRow,
  localDelivery: ConsoleWidgetLocalDelivery,
): ConsoleWidgetConnection {
  const routeHandle = typeof row.panda_route_handle === 'string' ? row.panda_route_handle.trim() : '';

  return routeHandle
    ? { status: 'configured_placeholder', routeHandle, localDelivery }
    : { status: 'not_configured', routeHandle: null, localDelivery };
}

function toConsoleSettingsWidget(row: WidgetSettingsRow): ConsoleSettingsWidget {
  return {
    id: row.id,
    siteId: row.site_id,
    publicKey: row.public_key,
    name: row.name,
    enabled: row.enabled,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toConsoleAllowedDomain(row: AllowedDomainRow): ConsoleAllowedDomain {
  return {
    id: row.id,
    widgetId: row.widget_id,
    domain: row.domain,
    enabled: row.enabled,
    createdAt: toIsoString(row.created_at),
  };
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCountNumber(value: string | number | bigint | null | undefined): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return Number(value);
  }

  return 0;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
