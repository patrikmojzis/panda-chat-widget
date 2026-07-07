import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import type { Insertable } from 'kysely';

import {
  requireAuthenticatedApi,
  requireUnsafeRequestCsrf,
  setNoStore,
  type AuthErrorResponse,
  type CsrfErrorResponse,
} from './auth-guard.ts';
import type { DatabaseClient, DatabaseSchema } from './db.ts';

export type ConsoleSiteRouteOptions = {
  database: DatabaseClient;
};

export type ConsoleSite = {
  id: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConsoleWidget = {
  id: string;
  siteId: string;
  publicKey: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConsoleSiteListResponse = {
  sites: ConsoleSite[];
};

export type ConsoleSiteResponse = {
  site: ConsoleSite;
};

export type ConsoleWidgetListResponse = {
  widgets: ConsoleWidget[];
};

export type ConsoleWidgetResponse = {
  widget: ConsoleWidget;
};

type ConsoleSiteErrorResponse =
  | AuthErrorResponse
  | CsrfErrorResponse
  | {
      error: 'invalid_site_request';
      reason: InvalidSiteRequestReason;
    }
  | {
      error: 'site_not_found';
    };

type ConsoleWidgetErrorResponse =
  | AuthErrorResponse
  | CsrfErrorResponse
  | {
      error: 'invalid_widget_request';
      reason: InvalidWidgetRequestReason;
    }
  | {
      error: 'site_not_found';
    };

type ConsoleSiteListRoute = {
  Reply: ConsoleSiteListResponse | AuthErrorResponse;
};

type ConsoleSiteCreateRoute = {
  Body: unknown;
  Reply: ConsoleSiteResponse | ConsoleSiteErrorResponse;
};

type ConsoleSiteReadRoute = {
  Params: SiteRouteParams;
  Reply: ConsoleSiteResponse | ConsoleSiteErrorResponse;
};

type ConsoleWidgetListRoute = {
  Params: SiteRouteParams;
  Reply: ConsoleWidgetListResponse | ConsoleWidgetErrorResponse;
};

type ConsoleWidgetCreateRoute = {
  Params: SiteRouteParams;
  Body: unknown;
  Reply: ConsoleWidgetResponse | ConsoleWidgetErrorResponse;
};

type SiteRouteParams = {
  siteId: string;
};

type SiteRow = {
  id: string;
  workspace_id: string | null;
  name: string;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type WidgetRow = {
  id: string;
  site_id: string;
  public_key: string;
  name: string;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type NameRequestBody = {
  name?: unknown;
};

type NameReadResult =
  | {
      status: 'valid';
      name: string;
    }
  | {
      status: 'invalid';
      reason: 'missing_name' | 'invalid_name';
    };

type SiteIdReadResult =
  | {
      status: 'valid';
      siteId: string;
    }
  | {
      status: 'invalid';
      reason: 'missing_site_id' | 'invalid_site_id';
    };

type InvalidSiteRequestReason = 'missing_name' | 'invalid_name' | 'missing_site_id' | 'invalid_site_id';
type InvalidWidgetRequestReason = 'missing_name' | 'invalid_name' | 'missing_site_id' | 'invalid_site_id';

const NAME_MAX_LENGTH = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerConsoleSiteRoutes(app: FastifyInstance, options: ConsoleSiteRouteOptions): void {
  app.get<ConsoleSiteListRoute>('/api/console/sites', async (request, reply) => {
    setNoStore(reply);
    const auth = await requireAuthenticatedApi(options.database, request, reply);

    if (!auth) {
      return;
    }

    return reply.send({ sites: await listConsoleSites(options.database, auth.workspace.id) });
  });

  app.post<ConsoleSiteCreateRoute>('/api/console/sites', async (request, reply) => {
    setNoStore(reply);
    const auth = await requireAuthenticatedApi(options.database, request, reply);

    if (!auth) {
      return;
    }

    if (!(await requireUnsafeRequestCsrf(request, reply))) {
      return;
    }

    const siteRequest = readName(request.body);

    if (siteRequest.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_site_request', reason: siteRequest.reason });
    }

    const site = await createConsoleSite(options.database, {
      workspaceId: auth.workspace.id,
      name: siteRequest.name,
    });

    return reply.status(201).send({ site });
  });

  app.get<ConsoleSiteReadRoute>('/api/console/sites/:siteId', async (request, reply) => {
    setNoStore(reply);
    const auth = await requireAuthenticatedApi(options.database, request, reply);

    if (!auth) {
      return;
    }

    const siteId = readSiteId(request.params);

    if (siteId.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_site_request', reason: siteId.reason });
    }

    const site = await findConsoleSite(options.database, {
      workspaceId: auth.workspace.id,
      siteId: siteId.siteId,
    });

    if (!site) {
      return reply.status(404).send({ error: 'site_not_found' });
    }

    return reply.send({ site });
  });

  app.get<ConsoleWidgetListRoute>('/api/console/sites/:siteId/widgets', async (request, reply) => {
    setNoStore(reply);
    const auth = await requireAuthenticatedApi(options.database, request, reply);

    if (!auth) {
      return;
    }

    const siteId = readSiteId(request.params);

    if (siteId.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_widget_request', reason: siteId.reason });
    }

    const site = await findConsoleSite(options.database, {
      workspaceId: auth.workspace.id,
      siteId: siteId.siteId,
    });

    if (!site) {
      return reply.status(404).send({ error: 'site_not_found' });
    }

    return reply.send({ widgets: await listConsoleWidgets(options.database, site.id) });
  });

  app.post<ConsoleWidgetCreateRoute>('/api/console/sites/:siteId/widgets', async (request, reply) => {
    setNoStore(reply);
    const auth = await requireAuthenticatedApi(options.database, request, reply);

    if (!auth) {
      return;
    }

    if (!(await requireUnsafeRequestCsrf(request, reply))) {
      return;
    }

    const siteId = readSiteId(request.params);

    if (siteId.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_widget_request', reason: siteId.reason });
    }

    const widgetRequest = readName(request.body);

    if (widgetRequest.status === 'invalid') {
      return reply.status(400).send({ error: 'invalid_widget_request', reason: widgetRequest.reason });
    }

    const site = await findConsoleSite(options.database, {
      workspaceId: auth.workspace.id,
      siteId: siteId.siteId,
    });

    if (!site) {
      return reply.status(404).send({ error: 'site_not_found' });
    }

    const widget = await createConsoleWidget(options.database, {
      siteId: site.id,
      name: widgetRequest.name,
    });

    return reply.status(201).send({ widget });
  });
}

export async function listConsoleSites(database: DatabaseClient, workspaceId: string): Promise<ConsoleSite[]> {
  const rows = (await database
    .selectFrom('sites')
    .select(['id', 'workspace_id', 'name', 'enabled', 'created_at', 'updated_at'])
    .where('workspace_id', '=', workspaceId)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute()) as SiteRow[];

  return rows.map(toConsoleSite);
}

export async function createConsoleSite(
  database: DatabaseClient,
  input: { workspaceId: string; name: string; now?: Date },
): Promise<ConsoleSite> {
  const now = input.now ?? new Date();
  const values = {
    workspace_id: input.workspaceId,
    name: input.name,
    enabled: true,
    created_at: now,
    updated_at: now,
  } satisfies Insertable<DatabaseSchema['sites']>;

  const row = (await database
    .insertInto('sites')
    .values(values)
    .returning(['id', 'workspace_id', 'name', 'enabled', 'created_at', 'updated_at'])
    .executeTakeFirstOrThrow()) as SiteRow;

  return toConsoleSite(row);
}

export async function findConsoleSite(
  database: DatabaseClient,
  input: { workspaceId: string; siteId: string },
): Promise<ConsoleSite | null> {
  const row = (await database
    .selectFrom('sites')
    .select(['id', 'workspace_id', 'name', 'enabled', 'created_at', 'updated_at'])
    .where('id', '=', input.siteId)
    .where('workspace_id', '=', input.workspaceId)
    .executeTakeFirst()) as SiteRow | undefined;

  return row ? toConsoleSite(row) : null;
}

export async function listConsoleWidgets(database: DatabaseClient, siteId: string): Promise<ConsoleWidget[]> {
  const rows = (await database
    .selectFrom('widgets')
    .select(['id', 'site_id', 'public_key', 'name', 'enabled', 'created_at', 'updated_at'])
    .where('site_id', '=', siteId)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute()) as WidgetRow[];

  return rows.map(toConsoleWidget);
}

export async function createConsoleWidget(
  database: DatabaseClient,
  input: { siteId: string; name: string; now?: Date },
): Promise<ConsoleWidget> {
  const now = input.now ?? new Date();
  const values = {
    site_id: input.siteId,
    public_key: createPublicWidgetKey(),
    name: input.name,
    enabled: true,
    created_at: now,
    updated_at: now,
  } satisfies Insertable<DatabaseSchema['widgets']>;

  const row = (await database
    .insertInto('widgets')
    .values(values)
    .returning(['id', 'site_id', 'public_key', 'name', 'enabled', 'created_at', 'updated_at'])
    .executeTakeFirstOrThrow()) as WidgetRow;

  return toConsoleWidget(row);
}

export function createPublicWidgetKey(): string {
  return `widget_${randomUUID()}`;
}

function readName(body: unknown): NameReadResult {
  if (typeof body !== 'object' || body === null || !('name' in body)) {
    return { status: 'invalid', reason: 'missing_name' };
  }

  const value = (body as NameRequestBody).name;

  if (typeof value !== 'string') {
    return { status: 'invalid', reason: 'invalid_name' };
  }

  const name = value.trim();

  if (!name) {
    return { status: 'invalid', reason: 'missing_name' };
  }

  if (name.length > NAME_MAX_LENGTH) {
    return { status: 'invalid', reason: 'invalid_name' };
  }

  return { status: 'valid', name };
}

function readSiteId(params: unknown): SiteIdReadResult {
  if (typeof params !== 'object' || params === null || !('siteId' in params)) {
    return { status: 'invalid', reason: 'missing_site_id' };
  }

  const value = (params as Partial<SiteRouteParams>).siteId;

  if (typeof value !== 'string') {
    return { status: 'invalid', reason: 'invalid_site_id' };
  }

  const siteId = value.trim();

  if (!siteId) {
    return { status: 'invalid', reason: 'missing_site_id' };
  }

  if (!UUID_PATTERN.test(siteId)) {
    return { status: 'invalid', reason: 'invalid_site_id' };
  }

  return { status: 'valid', siteId };
}

function toConsoleSite(row: SiteRow): ConsoleSite {
  if (row.workspace_id === null) {
    throw new Error('Console site row is missing workspace ownership');
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    enabled: row.enabled,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toConsoleWidget(row: WidgetRow): ConsoleWidget {
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

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
