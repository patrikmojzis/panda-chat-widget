import { type FormEvent, useEffect, useState } from 'react';
import {
  ApiError,
  getCurrentContext,
  getSetupStatus,
  login,
  logout,
  setupFirstOwner,
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
            replaceConsolePath('/console');
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
  async function handleLogout() {
    await logout();
    replaceConsolePath('/console/login');
    onLoggedOut();
  }

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
          <a className="nav-link nav-link--active" href="/console" aria-current="page">Dashboard</a>
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

        <section className="dashboard-card" aria-labelledby="dashboard-title">
          <p className="eyebrow">Dashboard</p>
          <h2 id="dashboard-title">Console shell ready</h2>
          <p>
            Your workspace boundary is active. Dashboard metrics and widget management will be added in later slices.
          </p>
        </section>
      </main>
    </div>
  );
}

function replaceConsolePath(path: string) {
  if (window.location.pathname !== path) {
    window.history.replaceState(null, '', path);
  }
}
