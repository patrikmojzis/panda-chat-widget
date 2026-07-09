import { type FormEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  createSite,
  createWidget,
  createWidgetDomain,
  deleteWidgetDomain,
  getCurrentContext,
  getSetupStatus,
  getSite,
  getWidgetSettings,
  listSites,
  listWidgetDomains,
  listWidgets,
  login,
  logout,
  setupFirstOwner,
  updateWidgetSettings,
  type ConsoleAllowedDomain,
  type ConsoleSite,
  type ConsoleWidget,
  type ConsoleWidgetNextLocalReplyCandidate,
  type ConsoleWidgetSettings,
  type CurrentContext,
  type LoginInput,
  type SetupInput,
  type UpdateWidgetSettingsInput,
} from './console-api';

type AppState =
  | {
      status: 'loading';
    }
  | {
      status: 'setup';
    }
  | {
      status: 'login';
    }
  | {
      status: 'ready';
      context: CurrentContext;
    }
  | {
      status: 'error';
      message: string;
    };

type SubmitState = 'idle' | 'submitting' | 'error';

type ConsoleRoute =
  | {
      page: 'sites';
    }
  | {
      page: 'createSite';
    }
  | {
      page: 'siteDetail';
      siteId: string;
    }
  | {
      page: 'createWidget';
      siteId: string;
    }
  | {
      page: 'widgetDetail';
      siteId: string;
      widgetId: string;
    }
  | {
      page: 'notFound';
    };

export function App() {
  const [state, setState] = useState<AppState>({ status: 'loading' });

  useEffect(() => {
    let isCurrent = true;

    async function loadConsole() {
      try {
        const setupStatus = await getSetupStatus();

        try {
          const context = await getCurrentContext();

          if (isCurrent) {
            setState({ status: 'ready', context });

            if (isAuthPath(window.location.pathname)) {
              replaceConsolePath('/console');
            }
          }
        } catch (error) {
          if (!isCurrent) {
            return;
          }

          if (error instanceof ApiError && error.status === 401) {
            setState({ status: setupStatus.setupRequired ? 'setup' : 'login' });
            replaceConsolePath(setupStatus.setupRequired ? '/console/setup' : '/console/login');
            return;
          }

          setState({ status: 'error', message: 'Console could not load. Please refresh and try again.' });
        }
      } catch {
        if (isCurrent) {
          setState({ status: 'error', message: 'Console could not load. Please refresh and try again.' });
        }
      }
    }

    void loadConsole();

    return () => {
      isCurrent = false;
    };
  }, []);

  if (state.status === 'loading') {
    return <StatePanel tone="loading" title="Loading console…" body="Checking your workspace session." />;
  }

  if (state.status === 'error') {
    return <StatePanel tone="error" title="Console unavailable" body={state.message} role="alert" />;
  }

  if (state.status === 'setup') {
    return <SetupScreen onReady={(context) => setState({ status: 'ready', context })} />;
  }

  if (state.status === 'login') {
    return <LoginScreen onReady={(context) => setState({ status: 'ready', context })} />;
  }

  return <ConsoleShell context={state.context} onLoggedOut={() => setState({ status: 'login' })} />;
}

type ReadyHandler = (context: CurrentContext) => void;

type NavigateHandler = (path: string) => void;

type StatePanelProps = {
  body: string;
  role?: 'status' | 'alert';
  title: string;
  tone: 'loading' | 'error';
};

function StatePanel({ body, role = 'status', title, tone }: StatePanelProps) {
  return (
    <main className="auth-page" data-state={tone}>
      <section className="state-card" role={role} aria-live={role === 'alert' ? 'assertive' : 'polite'}>
        <p className="eyebrow">Panda Chat Console</p>
        <h1>{title}</h1>
        <p>{body}</p>
      </section>
    </main>
  );
}

function SetupScreen({ onReady }: { onReady: ReadyHandler }) {
  const [form, setForm] = useState<SetupInput>({ email: '', password: '', workspaceName: '' });
  const [submitState, setSubmitState] = useState<SubmitState>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState('submitting');

    try {
      const context = await setupFirstOwner(form);
      replaceConsolePath('/console');
      onReady(context);
    } catch {
      setSubmitState('error');
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit} aria-busy={submitState === 'submitting'}>
        <div className="auth-card__header">
          <p className="eyebrow">First owner setup</p>
          <h1>Create your workspace</h1>
          <p>Set up the first owner account for this self-hosted Panda Chat Widget console.</p>
        </div>

        <label className="field" htmlFor="setup-workspace-name">
          <span>Workspace name</span>
          <input
            id="setup-workspace-name"
            autoFocus
            placeholder="Acme Support"
            value={form.workspaceName}
            onChange={(event) => setForm({ ...form, workspaceName: event.currentTarget.value })}
            disabled={submitState === 'submitting'}
          />
        </label>

        <label className="field" htmlFor="setup-email">
          <span>Email</span>
          <input
            id="setup-email"
            type="email"
            placeholder="owner@example.com"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.currentTarget.value })}
            disabled={submitState === 'submitting'}
          />
        </label>

        <label className="field" htmlFor="setup-password">
          <span>Password</span>
          <input
            id="setup-password"
            type="password"
            placeholder="At least 8 characters"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
            disabled={submitState === 'submitting'}
          />
        </label>

        <FormStatus state={submitState} error="Setup failed. Check the fields and try again." />
        <button className="primary-button" type="submit" disabled={submitState === 'submitting'}>
          Create workspace
        </button>
      </form>
    </main>
  );
}

function LoginScreen({ onReady }: { onReady: ReadyHandler }) {
  const [form, setForm] = useState<LoginInput>({ email: '', password: '' });
  const [submitState, setSubmitState] = useState<SubmitState>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState('submitting');

    try {
      const context = await login(form);
      replaceConsolePath('/console');
      onReady(context);
    } catch {
      setSubmitState('error');
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit} aria-busy={submitState === 'submitting'}>
        <div className="auth-card__header">
          <p className="eyebrow">Owner login</p>
          <h1>Sign in to your console</h1>
          <p>Use your owner account to manage this workspace.</p>
        </div>

        <label className="field" htmlFor="login-email">
          <span>Email</span>
          <input
            id="login-email"
            type="email"
            autoFocus
            placeholder="owner@example.com"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.currentTarget.value })}
            disabled={submitState === 'submitting'}
          />
        </label>

        <label className="field" htmlFor="login-password">
          <span>Password</span>
          <input
            id="login-password"
            type="password"
            placeholder="Your password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
            disabled={submitState === 'submitting'}
          />
        </label>

        <FormStatus state={submitState} error="Invalid email or password." />
        <button className="primary-button" type="submit" disabled={submitState === 'submitting'}>
          Sign in
        </button>
      </form>
    </main>
  );
}

function FormStatus({ error, state }: { error: string; state: SubmitState }) {
  if (state === 'submitting') {
    return <p className="form-status" role="status">Working…</p>;
  }

  if (state === 'error') {
    return <p className="form-status form-status--error" role="alert">{error}</p>;
  }

  return <p className="form-status" aria-hidden="true">&nbsp;</p>;
}

function ConsoleShell({ context, onLoggedOut }: { context: CurrentContext; onLoggedOut: () => void }) {
  const [route, setRoute] = useState<ConsoleRoute>(() => parseConsoleRoute(window.location.pathname));

  useEffect(() => {
    function handlePopState() {
      setRoute(parseConsoleRoute(window.location.pathname));
    }

    window.addEventListener('popstate', handlePopState);

    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function navigate(path: string) {
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }

    setRoute(parseConsoleRoute(path));
  }

  async function handleLogout() {
    await logout();
    replaceConsolePath('/console/login');
    onLoggedOut();
  }

  const sitesActive = route.page === 'sites' || route.page === 'createSite' || route.page === 'siteDetail' || route.page === 'createWidget' || route.page === 'widgetDetail';

  return (
    <div className="console-shell">
      <aside className="sidebar" aria-label="Console navigation">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">P</span>
          <div>
            <p>Panda Chat</p>
            <span>Console</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Main navigation">
          <a
            className={`nav-link${sitesActive ? ' nav-link--active' : ''}`}
            href="/console/sites"
            aria-current={sitesActive ? 'page' : undefined}
            onClick={(event) => handleNavigationClick(event, '/console/sites', navigate)}
          >
            Sites
          </a>
        </nav>
        <div className="sidebar-user">
          <span>{context.user.email}</span>
          <button type="button" onClick={() => void handleLogout()}>Log out</button>
        </div>
      </aside>

      <main className="console-main">
        <header className="console-header">
          <div className="min-w-0">
            <p className="eyebrow">Workspace</p>
            <h1>{context.workspace.name}</h1>
          </div>
          <div className="user-pill" title={context.user.email}>{context.user.email}</div>
        </header>

        <ConsoleRouteView route={route} onNavigate={navigate} />
      </main>
    </div>
  );
}

function ConsoleRouteView({ onNavigate, route }: { onNavigate: NavigateHandler; route: ConsoleRoute }) {
  if (route.page === 'sites') {
    return <SiteListPage onNavigate={onNavigate} />;
  }

  if (route.page === 'createSite') {
    return <CreateSitePage onNavigate={onNavigate} />;
  }

  if (route.page === 'siteDetail') {
    return <SiteDetailPage onNavigate={onNavigate} siteId={route.siteId} />;
  }

  if (route.page === 'createWidget') {
    return <CreateWidgetPage onNavigate={onNavigate} siteId={route.siteId} />;
  }

  if (route.page === 'widgetDetail') {
    return <WidgetSettingsPage onNavigate={onNavigate} siteId={route.siteId} widgetId={route.widgetId} />;
  }

  return <NotFoundPage onNavigate={onNavigate} />;
}

type SiteListState =
  | {
      status: 'loading';
    }
  | {
      status: 'ready';
      sites: ConsoleSite[];
    }
  | {
      status: 'error';
    };

function SiteListPage({ onNavigate }: { onNavigate: NavigateHandler }) {
  const [state, setState] = useState<SiteListState>({ status: 'loading' });

  useEffect(() => {
    let isCurrent = true;

    async function loadSites() {
      try {
        const sites = await listSites();

        if (isCurrent) {
          setState({ status: 'ready', sites });
        }
      } catch {
        if (isCurrent) {
          setState({ status: 'error' });
        }
      }
    }

    void loadSites();

    return () => {
      isCurrent = false;
    };
  }, []);

  return (
    <section className="content-section" aria-labelledby="sites-title">
      <PageHeader
        eyebrow="Sites"
        title="Sites"
        body="Create a site for each web property that will use a chat widget."
        action={(
          <button className="primary-button" type="button" onClick={() => onNavigate('/console/sites/new')}>
            Create site
          </button>
        )}
        titleId="sites-title"
      />

      {state.status === 'loading' ? <InlineState title="Loading sites…" body="Fetching this workspace’s sites." /> : null}
      {state.status === 'error' ? (
        <InlineState tone="error" title="Sites unavailable" body="Refresh the page and try again." />
      ) : null}
      {state.status === 'ready' && state.sites.length === 0 ? (
        <EmptyState
          title="No sites yet"
          body="Create your first site to start organizing widgets for this workspace."
          actionLabel="Create site"
          onAction={() => onNavigate('/console/sites/new')}
        />
      ) : null}
      {state.status === 'ready' && state.sites.length > 0 ? (
        <div className="list-card" aria-label="Workspace sites">
          {state.sites.map((site) => (
            <button
              className="list-row"
              key={site.id}
              type="button"
              onClick={() => onNavigate(`/console/sites/${site.id}`)}
            >
              <span>
                <strong>{site.name}</strong>
                <small>Created {formatDate(site.createdAt)}</small>
              </span>
              <span className="row-pill">Open</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CreateSitePage({ onNavigate }: { onNavigate: NavigateHandler }) {
  const [name, setName] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState('submitting');

    try {
      const site = await createSite({ name });
      onNavigate(`/console/sites/${site.id}`);
    } catch {
      setSubmitState('error');
    }
  }

  return (
    <section className="content-section" aria-labelledby="create-site-title">
      <PageHeader
        eyebrow="Sites"
        title="Create site"
        body="Add a site to this workspace."
        titleId="create-site-title"
      />

      <form className="dashboard-card form-card" onSubmit={handleSubmit} aria-busy={submitState === 'submitting'}>
        <label className="field" htmlFor="site-name">
          <span>Site name</span>
          <input
            id="site-name"
            autoFocus
            placeholder="Marketing website"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            disabled={submitState === 'submitting'}
          />
        </label>
        <FormStatus state={submitState} error="Site could not be created. Check the name and try again." />
        <div className="button-row">
          <button className="primary-button" type="submit" disabled={submitState === 'submitting' || !name.trim()}>
            Create site
          </button>
          <button className="secondary-button" type="button" onClick={() => onNavigate('/console/sites')}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

type SiteDetailState =
  | {
      status: 'loading';
    }
  | {
      status: 'ready';
      site: ConsoleSite;
      widgets: ConsoleWidget[];
    }
  | {
      status: 'notFound';
    }
  | {
      status: 'error';
    };

function SiteDetailPage({ onNavigate, siteId }: { onNavigate: NavigateHandler; siteId: string }) {
  const [state, setState] = useState<SiteDetailState>({ status: 'loading' });

  useEffect(() => {
    let isCurrent = true;

    async function loadSite() {
      try {
        const [site, widgets] = await Promise.all([getSite(siteId), listWidgets(siteId)]);

        if (isCurrent) {
          setState({ status: 'ready', site, widgets });
        }
      } catch (error) {
        if (!isCurrent) {
          return;
        }

        setState(error instanceof ApiError && error.status === 404 ? { status: 'notFound' } : { status: 'error' });
      }
    }

    setState({ status: 'loading' });
    void loadSite();

    return () => {
      isCurrent = false;
    };
  }, [siteId]);

  if (state.status === 'loading') {
    return <InlineState title="Loading site…" body="Fetching site details and widgets." />;
  }

  if (state.status === 'notFound') {
    return <InlineState tone="error" title="Site not found" body="This site is not available in the current workspace." />;
  }

  if (state.status === 'error') {
    return <InlineState tone="error" title="Site unavailable" body="Refresh the page and try again." />;
  }

  return (
    <section className="content-section" aria-labelledby="site-detail-title">
      <PageHeader
        eyebrow="Site detail"
        title={state.site.name}
        body="Create and review widgets for this site."
        action={(
          <button className="primary-button" type="button" onClick={() => onNavigate(`/console/sites/${state.site.id}/widgets/new`)}>
            Create widget
          </button>
        )}
        titleId="site-detail-title"
      />

      <section className="dashboard-card" aria-labelledby="widgets-title">
        <div className="card-header-row">
          <div>
            <p className="eyebrow">Widgets</p>
            <h2 id="widgets-title">Widget list</h2>
          </div>
          <button className="secondary-button" type="button" onClick={() => onNavigate('/console/sites')}>
            Back to sites
          </button>
        </div>

        {state.widgets.length === 0 ? (
          <EmptyState
            title="No widgets yet"
            body="Create a widget for this site to generate its public key."
            actionLabel="Create widget"
            onAction={() => onNavigate(`/console/sites/${state.site.id}/widgets/new`)}
          />
        ) : (
          <div className="list-card list-card--nested" aria-label="Site widgets">
            {state.widgets.map((widget) => (
              <button
                className="list-row"
                key={widget.id}
                type="button"
                onClick={() => onNavigate(`/console/sites/${state.site.id}/widgets/${widget.id}`)}
              >
                <span>
                  <strong>{widget.name}</strong>
                  <small>Public key</small>
                </span>
                <code className="public-key">{widget.publicKey}</code>
              </button>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

type CreateWidgetState =
  | {
      status: 'loading';
    }
  | {
      status: 'ready';
      site: ConsoleSite;
    }
  | {
      status: 'notFound';
    }
  | {
      status: 'error';
    };

function CreateWidgetPage({ onNavigate, siteId }: { onNavigate: NavigateHandler; siteId: string }) {
  const [state, setState] = useState<CreateWidgetState>({ status: 'loading' });
  const [name, setName] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');

  useEffect(() => {
    let isCurrent = true;

    async function loadSite() {
      try {
        const site = await getSite(siteId);

        if (isCurrent) {
          setState({ status: 'ready', site });
        }
      } catch (error) {
        if (!isCurrent) {
          return;
        }

        setState(error instanceof ApiError && error.status === 404 ? { status: 'notFound' } : { status: 'error' });
      }
    }

    setState({ status: 'loading' });
    void loadSite();

    return () => {
      isCurrent = false;
    };
  }, [siteId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState('submitting');

    try {
      await createWidget(siteId, { name });
      onNavigate(`/console/sites/${siteId}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setState({ status: 'notFound' });
      } else {
        setSubmitState('error');
      }
    }
  }

  if (state.status === 'loading') {
    return <InlineState title="Loading site…" body="Checking the site before creating a widget." />;
  }

  if (state.status === 'notFound') {
    return <InlineState tone="error" title="Site not found" body="This site is not available in the current workspace." />;
  }

  if (state.status === 'error') {
    return <InlineState tone="error" title="Site unavailable" body="Refresh the page and try again." />;
  }

  return (
    <section className="content-section" aria-labelledby="create-widget-title">
      <PageHeader
        eyebrow="Widgets"
        title="Create widget"
        body={`Add a widget for ${state.site.name}.`}
        titleId="create-widget-title"
      />

      <form className="dashboard-card form-card" onSubmit={handleSubmit} aria-busy={submitState === 'submitting'}>
        <label className="field" htmlFor="widget-name">
          <span>Widget name</span>
          <input
            id="widget-name"
            autoFocus
            placeholder="Support widget"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            disabled={submitState === 'submitting'}
          />
        </label>
        <FormStatus state={submitState} error="Widget could not be created. Check the name and try again." />
        <div className="button-row">
          <button className="primary-button" type="submit" disabled={submitState === 'submitting' || !name.trim()}>
            Create widget
          </button>
          <button className="secondary-button" type="button" onClick={() => onNavigate(`/console/sites/${siteId}`)}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}


type WidgetSettingsState =
  | {
      status: 'loading';
    }
  | {
      status: 'ready';
      settings: ConsoleWidgetSettings;
      domains: ConsoleAllowedDomain[];
    }
  | {
      status: 'notFound';
    }
  | {
      status: 'error';
    };

type WidgetSettingsForm = {
  name: string;
  assistantDisplayName: string;
  launcherLabel: string;
  welcomeTitle: string;
  welcomeSubtitle: string;
  colorMode: 'light' | 'dark' | 'system';
};

function WidgetSettingsPage({
  onNavigate,
  siteId,
  widgetId,
}: {
  onNavigate: NavigateHandler;
  siteId: string;
  widgetId: string;
}) {
  const [state, setState] = useState<WidgetSettingsState>({ status: 'loading' });
  const [form, setForm] = useState<WidgetSettingsForm | null>(null);
  const [domainDraft, setDomainDraft] = useState('');
  const [connectionDraft, setConnectionDraft] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [connectionSubmitState, setConnectionSubmitState] = useState<SubmitState>('idle');
  const [domainSubmitState, setDomainSubmitState] = useState<SubmitState>('idle');
  const [diagnosticsRefreshState, setDiagnosticsRefreshState] = useState<SubmitState>('idle');
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [targetCopyState, setTargetCopyState] = useState<'idle' | 'copied'>('idle');
  const currentWidgetRef = useRef({ siteId, widgetId });
  const currentCandidateIdRef = useRef<string | null>(null);
  currentWidgetRef.current = { siteId, widgetId };
  currentCandidateIdRef.current =
    state.status === 'ready' ? (state.settings.connection.localDelivery.nextLocalReplyCandidate?.id ?? null) : null;

  useEffect(() => {
    let isCurrent = true;

    async function loadWidgetSettings() {
      try {
        const [settings, domains] = await Promise.all([
          getWidgetSettings(siteId, widgetId),
          listWidgetDomains(siteId, widgetId),
        ]);

        if (isCurrent) {
          setState({ status: 'ready', settings, domains });
          setForm(formFromSettings(settings));
          setConnectionDraft(settings.connection.routeHandle ?? '');
          setCopyState('idle');
          setTargetCopyState('idle');
        }
      } catch (error) {
        if (!isCurrent) {
          return;
        }

        setState(error instanceof ApiError && error.status === 404 ? { status: 'notFound' } : { status: 'error' });
      }
    }

    setState({ status: 'loading' });
    setForm(null);
    setConnectionDraft('');
    setDiagnosticsRefreshState('idle');
    void loadWidgetSettings();

    return () => {
      isCurrent = false;
    };
  }, [siteId, widgetId]);

  async function refreshReadyState() {
    const [settings, domains] = await Promise.all([
      getWidgetSettings(siteId, widgetId),
      listWidgetDomains(siteId, widgetId),
    ]);
    setState({ status: 'ready', settings, domains });
    setForm(formFromSettings(settings));
    setConnectionDraft(settings.connection.routeHandle ?? '');
    setCopyState('idle');
    setTargetCopyState('idle');
  }

  async function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form) {
      return;
    }

    setSubmitState('submitting');

    try {
      const input: UpdateWidgetSettingsInput = {
        name: form.name,
        config: {
          assistant: { displayName: form.assistantDisplayName },
          launcher: { label: form.launcherLabel, icon: 'message' },
          welcome: { title: form.welcomeTitle, subtitle: form.welcomeSubtitle },
          theme: { colorMode: form.colorMode, accent: 'blue', radius: 'md' },
        },
      };
      const settings = await updateWidgetSettings(siteId, widgetId, input);

      if (state.status === 'ready') {
        setState({ status: 'ready', settings, domains: state.domains });
      }

      setForm(formFromSettings(settings));
      setSubmitState('idle');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setState({ status: 'notFound' });
      } else {
        setSubmitState('error');
      }
    }
  }

  async function handleConnectionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const routeHandle = connectionDraft.trim();

    if (!routeHandle) {
      return;
    }

    setConnectionSubmitState('submitting');

    try {
      const settings = await updateWidgetSettings(siteId, widgetId, { connection: { routeHandle } });

      if (state.status === 'ready') {
        setState({ status: 'ready', settings, domains: state.domains });
      }

      setConnectionDraft(settings.connection.routeHandle ?? '');
      setConnectionSubmitState('idle');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setState({ status: 'notFound' });
      } else {
        setConnectionSubmitState('error');
      }
    }
  }

  async function handleConnectionClear() {
    setConnectionSubmitState('submitting');

    try {
      const settings = await updateWidgetSettings(siteId, widgetId, { connection: { routeHandle: null } });

      if (state.status === 'ready') {
        setState({ status: 'ready', settings, domains: state.domains });
      }

      setConnectionDraft('');
      setConnectionSubmitState('idle');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setState({ status: 'notFound' });
      } else {
        setConnectionSubmitState('error');
      }
    }
  }

  async function handleDomainSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const domain = domainDraft.trim();

    if (!domain) {
      return;
    }

    setDomainSubmitState('submitting');

    try {
      await createWidgetDomain(siteId, widgetId, { domain });
      setDomainDraft('');
      await refreshReadyState();
      setDomainSubmitState('idle');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setState({ status: 'notFound' });
      } else {
        setDomainSubmitState('error');
      }
    }
  }

  async function handleDeleteDomain(domainId: string) {
    setDomainSubmitState('submitting');

    try {
      await deleteWidgetDomain(siteId, widgetId, domainId);
      await refreshReadyState();
      setDomainSubmitState('idle');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setState({ status: 'notFound' });
      } else {
        setDomainSubmitState('error');
      }
    }
  }

  async function handleLocalDiagnosticsRefresh() {
    const diagnosticsSiteId = siteId;
    const diagnosticsWidgetId = widgetId;
    setDiagnosticsRefreshState('submitting');

    try {
      const refreshedSettings = await getWidgetSettings(diagnosticsSiteId, diagnosticsWidgetId);

      if (currentWidgetRef.current.siteId !== diagnosticsSiteId || currentWidgetRef.current.widgetId !== diagnosticsWidgetId) {
        return;
      }

      const refreshedLocalDelivery = refreshedSettings.connection.localDelivery;
      const refreshedCandidateId = refreshedLocalDelivery.nextLocalReplyCandidate?.id ?? null;

      if (currentCandidateIdRef.current !== refreshedCandidateId) {
        setTargetCopyState('idle');
      }

      setState((currentState) => {
        if (currentState.status !== 'ready') {
          return currentState;
        }

        return {
          ...currentState,
          settings: {
            ...currentState.settings,
            connection: {
              ...currentState.settings.connection,
              localDelivery: refreshedLocalDelivery,
            },
          },
        };
      });
      setDiagnosticsRefreshState('idle');
    } catch {
      if (currentWidgetRef.current.siteId !== diagnosticsSiteId || currentWidgetRef.current.widgetId !== diagnosticsWidgetId) {
        return;
      }

      setDiagnosticsRefreshState('error');
    }
  }

  function handleCopySnippet(snippet: string) {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(snippet).then(() => setCopyState('copied'));
    }
  }

  function handleCopyNextLocalReplyTarget(intentId: string) {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(intentId).then(() => setTargetCopyState('copied'));
    }
  }

  if (state.status === 'loading') {
    return <InlineState title="Loading widget settings…" body="Fetching safe settings, allowed domains, and install status." />;
  }

  if (state.status === 'notFound') {
    return <InlineState tone="error" title="Widget not found" body="This widget is not available in the current workspace." />;
  }

  if (state.status === 'error' || !form) {
    return <InlineState tone="error" title="Widget settings unavailable" body="Refresh the page and try again." />;
  }

  const snippet = state.settings.install.snippet;
  const hasSnippet = state.settings.install.snippetAvailable && snippet !== null;
  const canSaveSettings = Boolean(
    form.name.trim() &&
    form.assistantDisplayName.trim() &&
    form.launcherLabel.trim() &&
    form.welcomeTitle.trim() &&
    form.welcomeSubtitle.trim(),
  );
  const nextLocalReplyCandidate = state.settings.connection.localDelivery.nextLocalReplyCandidate;

  return (
    <section className="content-section" aria-labelledby="widget-settings-title">
      <PageHeader
        eyebrow="Widget settings"
        title={state.settings.widget.name}
        body="Manage safe widget copy, allowed domains, and the install snippet for this public key."
        action={(
          <button className="secondary-button" type="button" onClick={() => onNavigate(`/console/sites/${siteId}`)}>
            Back to site
          </button>
        )}
        titleId="widget-settings-title"
      />

      <section className="dashboard-card" aria-labelledby="widget-public-key-title">
        <p className="eyebrow">Public key</p>
        <h2 id="widget-public-key-title">Server-owned key</h2>
        <p>Use this public key only in the loader snippet. It is safe to publish on allowed domains.</p>
        <code className="public-key">{state.settings.widget.publicKey}</code>
      </section>

      <form className="dashboard-card form-card form-card--wide" onSubmit={handleSettingsSubmit} aria-busy={submitState === 'submitting'}>
        <div>
          <p className="eyebrow">Safe config</p>
          <h2>Widget copy</h2>
          <p>Only plain text and existing theme tokens are supported here.</p>
        </div>
        <div className="settings-grid">
          <label className="field" htmlFor="widget-settings-name">
            <span>Widget name</span>
            <input
              id="widget-settings-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
              disabled={submitState === 'submitting'}
            />
          </label>
          <label className="field" htmlFor="widget-settings-assistant">
            <span>Assistant display name</span>
            <input
              id="widget-settings-assistant"
              value={form.assistantDisplayName}
              onChange={(event) => setForm({ ...form, assistantDisplayName: event.currentTarget.value })}
              disabled={submitState === 'submitting'}
            />
          </label>
          <label className="field" htmlFor="widget-settings-launcher">
            <span>Launcher label</span>
            <input
              id="widget-settings-launcher"
              value={form.launcherLabel}
              onChange={(event) => setForm({ ...form, launcherLabel: event.currentTarget.value })}
              disabled={submitState === 'submitting'}
            />
          </label>
          <label className="field" htmlFor="widget-settings-color-mode">
            <span>Theme color mode</span>
            <select
              id="widget-settings-color-mode"
              value={form.colorMode}
              onChange={(event) => setForm({ ...form, colorMode: event.currentTarget.value as WidgetSettingsForm['colorMode'] })}
              disabled={submitState === 'submitting'}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="field settings-grid__wide" htmlFor="widget-settings-title-input">
            <span>Welcome title</span>
            <input
              id="widget-settings-title-input"
              value={form.welcomeTitle}
              onChange={(event) => setForm({ ...form, welcomeTitle: event.currentTarget.value })}
              disabled={submitState === 'submitting'}
            />
          </label>
          <label className="field settings-grid__wide" htmlFor="widget-settings-subtitle">
            <span>Welcome subtitle</span>
            <input
              id="widget-settings-subtitle"
              value={form.welcomeSubtitle}
              onChange={(event) => setForm({ ...form, welcomeSubtitle: event.currentTarget.value })}
              disabled={submitState === 'submitting'}
            />
          </label>
        </div>
        <FormStatus state={submitState} error="Settings could not be saved. Check the plain text fields and try again." />
        <div className="button-row">
          <button className="primary-button" type="submit" disabled={submitState === 'submitting' || !canSaveSettings}>
            Save settings
          </button>
        </div>
      </form>

      <section className="dashboard-card" aria-labelledby="panda-connection-title" aria-busy={diagnosticsRefreshState === 'submitting'}>
        <div>
          <p className="eyebrow">Panda connection</p>
          <h2 id="panda-connection-title">Connection placeholder</h2>
          <p>Owner-only local deterministic fake reply diagnostic. It shows queued and claimed local future-dispatch intents plus fake reply rows applied locally; Gateway/CLI dispatch is not connected yet, so visitor messages still use the local fake reply loop.</p>
          <p>Manual local/demo-only diagnostics refreshes re-fetch the owner widget settings endpoint without saving drafts or reloading the page.</p>
        </div>
        <div className="connection-status">
          <span className="row-pill">{formatConnectionStatus(state.settings.connection.status)}</span>
          <small>{state.settings.connection.routeHandle ? 'A placeholder route handle is saved.' : 'No route handle is saved yet.'}</small>
          <small>{formatLocalDeliveryStatus(state.settings.connection.localDelivery)}</small>
        </div>
        <div className="button-row">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void handleLocalDiagnosticsRefresh()}
            disabled={diagnosticsRefreshState === 'submitting'}
          >
            {diagnosticsRefreshState === 'submitting' ? 'Refreshing local diagnostics…' : 'Refresh local diagnostics'}
          </button>
        </div>
        <FormStatus state={diagnosticsRefreshState} error="Local diagnostics could not be refreshed. Unsaved widget copy and route handle drafts were kept; try again." />
        {nextLocalReplyCandidate ? (
          <div className="list-card list-card--nested" aria-label="Next local manual reply target">
            <div className="list-row list-row--static">
              <span>
                <strong>next manual reply target ID</strong>
                <code className="public-key">{nextLocalReplyCandidate.id}</code>
                <small>Local-only targetIntentId for local-panda:reply-manual.</small>
              </span>
              <button
                className="secondary-button"
                type="button"
                onClick={() => handleCopyNextLocalReplyTarget(nextLocalReplyCandidate.id)}
              >
                {targetCopyState === 'copied' ? 'Copied' : 'Copy target ID'}
              </button>
            </div>
            <NextLocalReplyCandidateDetails candidate={nextLocalReplyCandidate} />
          </div>
        ) : (
          <div className="empty-state" aria-label="No next local manual reply target">
            <h3>No next manual reply target ID</h3>
            <p>Send a visitor message or leave a claimed local intent unapplied to show the next local-only target.</p>
          </div>
        )}
        <form className="inline-form" onSubmit={handleConnectionSubmit} aria-busy={connectionSubmitState === 'submitting'}>
          <label className="field" htmlFor="widget-connection-route-handle">
            <span>Route handle</span>
            <input
              id="widget-connection-route-handle"
              placeholder="panda:workspace/route"
              value={connectionDraft}
              onChange={(event) => setConnectionDraft(event.currentTarget.value)}
              disabled={connectionSubmitState === 'submitting'}
            />
          </label>
          <button className="primary-button" type="submit" disabled={connectionSubmitState === 'submitting' || !connectionDraft.trim()}>
            Save placeholder
          </button>
        </form>
        <div className="button-row">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void handleConnectionClear()}
            disabled={connectionSubmitState === 'submitting' || (!state.settings.connection.routeHandle && !connectionDraft.trim())}
          >
            Clear connection
          </button>
        </div>
        <FormStatus state={connectionSubmitState} error="Panda connection placeholder could not be saved. Check the route handle and try again." />
      </section>

      <section className="dashboard-card" aria-labelledby="allowed-domains-title">
        <div>
          <p className="eyebrow">Allowed domains</p>
          <h2 id="allowed-domains-title">Allowed domains</h2>
          <p>Add each hostname where this widget may bootstrap. Ports are ignored for schemeful origins.</p>
        </div>

        {state.domains.length === 0 ? (
          <EmptyState
            title="No allowed domains yet"
            body="Add an allowed domain before installing this widget on a website."
            actionLabel="Focus domain field"
            onAction={() => document.getElementById('widget-domain-input')?.focus()}
          />
        ) : (
          <div className="list-card list-card--nested" aria-label="Allowed widget domains">
            {state.domains.map((domain) => (
              <div className="list-row list-row--static" key={domain.id}>
                <span>
                  <strong>{domain.domain}</strong>
                  <small>Created {formatDate(domain.createdAt)}</small>
                </span>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void handleDeleteDomain(domain.id)}
                  disabled={domainSubmitState === 'submitting'}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        <form className="inline-form" onSubmit={handleDomainSubmit} aria-busy={domainSubmitState === 'submitting'}>
          <label className="field" htmlFor="widget-domain-input">
            <span>Domain or origin</span>
            <input
              id="widget-domain-input"
              placeholder="example.com or https://example.com"
              value={domainDraft}
              onChange={(event) => setDomainDraft(event.currentTarget.value)}
              disabled={domainSubmitState === 'submitting'}
            />
          </label>
          <button className="primary-button" type="submit" disabled={domainSubmitState === 'submitting' || !domainDraft.trim()}>
            Add domain
          </button>
        </form>
        <FormStatus state={domainSubmitState} error="Domain could not be updated. Check the hostname and try again." />
      </section>

      <section className="dashboard-card" aria-labelledby="install-snippet-title">
        <div>
          <p className="eyebrow">Install snippet</p>
          <h2 id="install-snippet-title">Copy loader snippet</h2>
          <p>The snippet appears after at least one allowed domain exists.</p>
        </div>
        {hasSnippet ? (
          <>
            <textarea className="snippet-box" readOnly value={snippet} aria-label="Install snippet" />
            <div className="button-row">
              <button className="secondary-button" type="button" onClick={() => handleCopySnippet(snippet)}>
                {copyState === 'copied' ? 'Copied' : 'Copy snippet'}
              </button>
            </div>
          </>
        ) : (
          <InlineState title="Snippet locked" body="Add an allowed domain to generate the install snippet." />
        )}
      </section>
    </section>
  );
}

function NextLocalReplyCandidateDetails({ candidate }: { candidate: ConsoleWidgetNextLocalReplyCandidate }) {
  return (
    <dl className="local-reply-candidate-details" aria-label="Next local reply candidate details">
      <div className="local-reply-candidate-detail">
        <dt>status</dt>
        <dd><code className="public-key">{candidate.status}</code></dd>
      </div>
      <div className="local-reply-candidate-detail">
        <dt>conversationId</dt>
        <dd><code className="public-key">{candidate.conversationId}</code></dd>
      </div>
      <div className="local-reply-candidate-detail">
        <dt>visitorMessageId</dt>
        <dd><code className="public-key">{candidate.visitorMessageId}</code></dd>
      </div>
      <div className="local-reply-candidate-detail">
        <dt>clientMessageId</dt>
        <dd><code className="public-key">{candidate.clientMessageId}</code></dd>
      </div>
      <div className="local-reply-candidate-detail">
        <dt>createdAt</dt>
        <dd><code className="public-key">{candidate.createdAt}</code></dd>
      </div>
      <div className="local-reply-candidate-detail">
        <dt>claimedAt</dt>
        <dd><code className="public-key">{candidate.claimedAt ?? 'not claimed yet'}</code></dd>
      </div>
    </dl>
  );
}

function formatConnectionStatus(status: ConsoleWidgetSettings['connection']['status']): string {
  return status === 'configured_placeholder' ? 'Configured placeholder' : 'Not configured';
}

function formatLocalDeliveryStatus(localDelivery: ConsoleWidgetSettings['connection']['localDelivery']): string {
  const queued = localDelivery.queuedIntentCount === 1
    ? '1 queued intent'
    : `${localDelivery.queuedIntentCount} queued intents`;
  const claimed = localDelivery.claimedIntentCount === 1
    ? '1 intent claimed locally'
    : `${localDelivery.claimedIntentCount} intents claimed locally`;
  const applied = localDelivery.appliedLocalReplyCount === 1
    ? '1 fake reply application'
    : `${localDelivery.appliedLocalReplyCount} fake reply applications`;
  const lastQueued = localDelivery.lastQueuedAt ? `last queued ${formatDate(localDelivery.lastQueuedAt)}` : 'last queued never';
  const lastClaimed = localDelivery.lastClaimedAt
    ? `last claimed locally ${formatDate(localDelivery.lastClaimedAt)}`
    : localDelivery.claimedIntentCount > 0
      ? 'last claimed timestamp unavailable'
      : 'last claimed locally never';
  const lastApplied = localDelivery.lastAppliedLocalReplyAt
    ? `last applied locally ${formatDate(localDelivery.lastAppliedLocalReplyAt)}`
    : localDelivery.appliedLocalReplyCount > 0
      ? 'last applied timestamp unavailable'
      : 'last applied locally never';

  return `Local deterministic fake reply diagnostic. Local future-dispatch queue: ${queued}; ${lastQueued}. Claimed locally: ${claimed}; ${lastClaimed}. Applied locally: ${applied}; ${lastApplied}.`;
}

function formFromSettings(settings: ConsoleWidgetSettings): WidgetSettingsForm {
  return {
    name: settings.widget.name,
    assistantDisplayName: settings.config.assistant.displayName,
    launcherLabel: settings.config.launcher.label,
    welcomeTitle: settings.config.welcome.title,
    welcomeSubtitle: settings.config.welcome.subtitle,
    colorMode: settings.config.theme.colorMode,
  };
}

function PageHeader({
  action,
  body,
  eyebrow,
  title,
  titleId,
}: {
  action?: ReactNode;
  body: string;
  eyebrow: string;
  title: string;
  titleId: string;
}) {
  return (
    <div className="page-header">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
        <p>{body}</p>
      </div>
      {action ? <div className="page-actions">{action}</div> : null}
    </div>
  );
}

function EmptyState({
  actionLabel,
  body,
  onAction,
  title,
}: {
  actionLabel: string;
  body: string;
  onAction: () => void;
  title: string;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
      <button className="secondary-button" type="button" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}

function InlineState({ body, title, tone = 'loading' }: { body: string; title: string; tone?: 'loading' | 'error' }) {
  return (
    <section className="dashboard-card" role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'}>
      <p className="eyebrow">{tone === 'error' ? 'Needs attention' : 'Loading'}</p>
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  );
}

function NotFoundPage({ onNavigate }: { onNavigate: NavigateHandler }) {
  return (
    <section className="dashboard-card" role="alert">
      <p className="eyebrow">Not found</p>
      <h2>Console page not found</h2>
      <p>Open the site list to continue managing this workspace.</p>
      <button className="secondary-button" type="button" onClick={() => onNavigate('/console/sites')}>
        View sites
      </button>
    </section>
  );
}

function parseConsoleRoute(pathname: string): ConsoleRoute {
  const pathnameWithoutTrailingSlash = pathname.replace(/\/+$/, '') || '/console';
  const segments = pathnameWithoutTrailingSlash.split('/').filter(Boolean).map(decodePathSegment);

  if (segments[0] !== 'console') {
    return { page: 'notFound' };
  }

  if (segments.length === 1) {
    return { page: 'sites' };
  }

  if (segments[1] !== 'sites') {
    return { page: 'notFound' };
  }

  if (segments.length === 2) {
    return { page: 'sites' };
  }

  if (segments.length === 3 && segments[2] === 'new') {
    return { page: 'createSite' };
  }

  if (segments.length === 3 && segments[2]) {
    return { page: 'siteDetail', siteId: segments[2] };
  }

  if (segments.length === 5 && segments[2] && segments[3] === 'widgets' && segments[4] === 'new') {
    return { page: 'createWidget', siteId: segments[2] };
  }

  if (segments.length === 5 && segments[2] && segments[3] === 'widgets' && segments[4]) {
    return { page: 'widgetDetail', siteId: segments[2], widgetId: segments[4] };
  }

  return { page: 'notFound' };
}

function handleNavigationClick(event: MouseEvent<HTMLAnchorElement>, path: string, navigate: NavigateHandler) {
  event.preventDefault();
  navigate(path);
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function isAuthPath(pathname: string): boolean {
  return pathname === '/console/login' || pathname === '/console/setup';
}

function replaceConsolePath(path: string) {
  if (window.location.pathname !== path) {
    window.history.replaceState(null, '', path);
  }
}
