export type WidgetBootstrapConfig = {
  assistant: {
    displayName: string;
  };
  launcher: {
    label: string;
    icon: 'message';
  };
  welcome: {
    title: string;
    subtitle: string;
  };
  theme: {
    colorMode: 'light' | 'dark' | 'system';
    accent: 'blue';
    radius: 'md';
  };
};

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

export type WidgetBootstrapFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'json' | 'ok' | 'status'>>;

export type WidgetBootstrapOptions = {
  baseHref?: string;
  fetchImpl?: WidgetBootstrapFetch;
};

export type WidgetBootstrapLoadState =
  | {
      status: 'missing_key';
    }
  | {
      status: 'loading';
    }
  | {
      status: 'loaded';
      bootstrap: WidgetBootstrapResponse;
    }
  | {
      status: 'error';
      reason: 'request_failed';
    };

function defaultBaseHref(): string {
  return window.location.href;
}

function defaultFetch(): WidgetBootstrapFetch {
  return fetch;
}

export function buildWidgetBootstrapUrl(publicKey: string, baseHref = defaultBaseHref()): string {
  return new URL(`/api/widgets/${encodeURIComponent(publicKey)}/bootstrap`, baseHref).toString();
}

export async function fetchWidgetBootstrap(
  publicKey: string,
  options: WidgetBootstrapOptions = {},
): Promise<WidgetBootstrapResponse> {
  const requestUrl = buildWidgetBootstrapUrl(publicKey, options.baseHref);
  const fetchImpl = options.fetchImpl ?? defaultFetch();
  const response = await fetchImpl(requestUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(`Bootstrap request failed with status ${response.status}`);
  }

  return (await response.json()) as WidgetBootstrapResponse;
}

export async function loadWidgetBootstrap(
  publicKey: string | null,
  options: WidgetBootstrapOptions = {},
): Promise<WidgetBootstrapLoadState> {
  if (!publicKey) {
    return { status: 'missing_key' };
  }

  try {
    const bootstrap = await fetchWidgetBootstrap(publicKey, options);

    return { status: 'loaded', bootstrap };
  } catch {
    return { status: 'error', reason: 'request_failed' };
  }
}
