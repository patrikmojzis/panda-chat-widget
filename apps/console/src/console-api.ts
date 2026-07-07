export type CurrentUser = {
  id: string;
  email: string;
};

export type CurrentWorkspace = {
  id: string;
  name: string;
};

export type CurrentContext = {
  user: CurrentUser;
  workspace: CurrentWorkspace;
};

export type SetupStatus = {
  setupRequired: boolean;
};

export type SetupInput = {
  email: string;
  password: string;
  workspaceName: string;
};

export type LoginInput = {
  email: string;
  password: string;
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

export type CreateSiteInput = {
  name: string;
};

export type CreateWidgetInput = {
  name: string;
};

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

type ApiRequestOptions = {
  body?: unknown;
  method?: 'GET' | 'POST';
};

type SiteListResponse = {
  sites: ConsoleSite[];
};

type SiteResponse = {
  site: ConsoleSite;
};

type WidgetListResponse = {
  widgets: ConsoleWidget[];
};

type WidgetResponse = {
  widget: ConsoleWidget;
};

export function getSetupStatus(): Promise<SetupStatus> {
  return apiRequest('/api/auth/setup-status');
}

export function getCurrentContext(): Promise<CurrentContext> {
  return apiRequest('/api/me');
}

export function setupFirstOwner(input: SetupInput): Promise<CurrentContext> {
  return apiRequest('/api/auth/setup', { method: 'POST', body: input });
}

export function login(input: LoginInput): Promise<CurrentContext> {
  return apiRequest('/api/auth/login', { method: 'POST', body: input });
}

export function logout(): Promise<void> {
  return apiRequest('/api/auth/logout', { method: 'POST' });
}

export async function listSites(): Promise<ConsoleSite[]> {
  const response = await apiRequest<SiteListResponse>('/api/console/sites');

  return response.sites;
}

export async function getSite(siteId: string): Promise<ConsoleSite> {
  const response = await apiRequest<SiteResponse>(`/api/console/sites/${encodeURIComponent(siteId)}`);

  return response.site;
}

export async function createSite(input: CreateSiteInput): Promise<ConsoleSite> {
  const response = await apiRequest<SiteResponse>('/api/console/sites', { method: 'POST', body: input });

  return response.site;
}

export async function listWidgets(siteId: string): Promise<ConsoleWidget[]> {
  const response = await apiRequest<WidgetListResponse>(`/api/console/sites/${encodeURIComponent(siteId)}/widgets`);

  return response.widgets;
}

export async function createWidget(siteId: string, input: CreateWidgetInput): Promise<ConsoleWidget> {
  const response = await apiRequest<WidgetResponse>(`/api/console/sites/${encodeURIComponent(siteId)}/widgets`, {
    method: 'POST',
    body: input,
  });

  return response.widget;
}

async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    accept: 'application/json',
  };
  const init: RequestInit = {
    credentials: 'include',
    headers,
    method,
  };

  if (method !== 'GET') {
    headers['x-panda-csrf'] = '1';
  }

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, init);

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
