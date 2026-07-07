import { type FormEvent, type MouseEvent, type ReactNode, useEffect, useState } from 'react';
import {
  ApiError,
  createSite,
  createWidget,
  getCurrentContext,
  getSetupStatus,
  getSite,
  listSites,
  listWidgets,
  login,
  logout,
  setupFirstOwner,
  type ConsoleSite,
  type ConsoleWidget,
  type CurrentContext,
  type LoginInput,
  type SetupInput,
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

  const sitesActive = route.page === 'sites' || route.page === 'createSite' || route.page === 'siteDetail' || route.page === 'createWidget';

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
              <div className="list-row list-row--static" key={widget.id}>
                <span>
                  <strong>{widget.name}</strong>
                  <small>Public key</small>
                </span>
                <code className="public-key">{widget.publicKey}</code>
              </div>
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
