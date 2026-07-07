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
