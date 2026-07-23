import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  createSite,
  createWidget,
  getCurrentContext,
  getSite,
  getSetupStatus,
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

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { WidgetSettingsPage } from './widget-settings';
import { ConsoleNavigation, PageHeader } from './console-presentation';
import { AlertCircle, ArrowLeft, ArrowRight, Menu, Plus, Sparkles } from 'lucide-react';

type AppState =
  | { status: 'loading' }
  | { status: 'setup' }
  | { status: 'login' }
  | { status: 'ready'; context: CurrentContext }
  | { status: 'error'; message: string };

type SubmitState = 'idle' | 'submitting' | 'error';

export type ConsoleRoute =
  | { page: 'sites' }
  | { page: 'createSite' }
  | { page: 'siteDetail'; siteId: string }
  | { page: 'createWidget'; siteId: string }
  | { page: 'widgetDetail'; siteId: string; widgetId: string }
  | { page: 'notFound' };

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
    return (
      <AuthPage>
        <Card className="w-full max-w-[440px]" role="status" aria-live="polite">
          <CardHeader className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Console</p>
            <CardTitle className="text-2xl">Loading console…</CardTitle>
            <CardDescription>Checking your workspace session.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Spinner className="size-6" />
          </CardContent>
        </Card>
      </AuthPage>
    );
  }

  if (state.status === 'error') {
    return (
      <AuthPage>
        <Card className="w-full max-w-[440px]" role="alert" aria-live="assertive">
          <CardHeader className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Console</p>
            <CardTitle className="text-2xl">Console unavailable</CardTitle>
            <CardDescription>{state.message}</CardDescription>
          </CardHeader>
        </Card>
      </AuthPage>
    );
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
export type NavigateHandler = (path: string) => void;

function AuthPage({ children }: { children: ReactNode }) {
  return (
    <main className="console-auth grid min-h-dvh min-w-0 place-items-center p-6">
      <div className="grid w-full max-w-[440px] gap-5">
        <div className="flex items-center justify-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground" aria-hidden="true"><Sparkles className="size-4" /></span>
          Panda Chat
        </div>
        {children}
      </div>
    </main>
  );
}

function SetupScreen({ onReady }: { onReady: ReadyHandler }) {
  const [form, setForm] = useState<SetupInput>({ email: '', password: '', workspaceName: '' });
  const [submitState, setSubmitState] = useState<SubmitState>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitState === 'submitting') return;
    setSubmitState('submitting');

    try {
      const context = await setupFirstOwner(form);
      replaceConsolePath('/console');
      onReady(context);
    } catch {
      setSubmitState('error');
    }
  }

  const errorId = 'setup-error';
  const hasError = submitState === 'error';

  return (
    <AuthPage>
      <Card className="w-full max-w-[440px]">
        <CardHeader className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">First owner setup</p>
          <h1 className="font-semibold leading-none tracking-tight text-2xl">Create your workspace</h1>
          <CardDescription>Set up the first owner account for this self-hosted Panda Chat Widget console.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} aria-busy={submitState === 'submitting'} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="setup-workspace-name">Workspace name</Label>
              <Input
                id="setup-workspace-name"
                autoFocus
                placeholder="Acme Support"
                value={form.workspaceName}
                onChange={(event) => setForm({ ...form, workspaceName: event.currentTarget.value })}
                disabled={submitState === 'submitting'}
                aria-invalid={hasError || undefined}
                aria-describedby={hasError ? errorId : undefined}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="setup-email">Email</Label>
              <Input
                id="setup-email"
                type="email"
                placeholder="owner@example.com"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.currentTarget.value })}
                disabled={submitState === 'submitting'}
                aria-invalid={hasError || undefined}
                aria-describedby={hasError ? errorId : undefined}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="setup-password">Password</Label>
              <Input
                id="setup-password"
                type="password"
                placeholder="At least 8 characters"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
                disabled={submitState === 'submitting'}
                aria-invalid={hasError || undefined}
                aria-describedby={hasError ? errorId : undefined}
              />
            </div>
            <FormStatus id={errorId} state={submitState} error="Setup failed. Check the fields and try again." />
            <Button type="submit" disabled={submitState === 'submitting'} className="w-full">
              {submitState === 'submitting' ? <><Spinner /> Creating…</> : 'Create workspace'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthPage>
  );
}

function LoginScreen({ onReady }: { onReady: ReadyHandler }) {
  const [form, setForm] = useState<LoginInput>({ email: '', password: '' });
  const [submitState, setSubmitState] = useState<SubmitState>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitState === 'submitting') return;
    setSubmitState('submitting');

    try {
      const context = await login(form);
      replaceConsolePath('/console');
      onReady(context);
    } catch {
      setSubmitState('error');
    }
  }

  const errorId = 'login-error';
  const hasError = submitState === 'error';

  return (
    <AuthPage>
      <Card className="w-full max-w-[440px]">
        <CardHeader className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Owner login</p>
          <h1 className="font-semibold leading-none tracking-tight text-2xl">Sign in to your console</h1>
          <CardDescription>Use your owner account to manage this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} aria-busy={submitState === 'submitting'} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                autoFocus
                placeholder="owner@example.com"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.currentTarget.value })}
                disabled={submitState === 'submitting'}
                aria-invalid={hasError || undefined}
                aria-describedby={hasError ? errorId : undefined}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                placeholder="Your password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
                disabled={submitState === 'submitting'}
                aria-invalid={hasError || undefined}
                aria-describedby={hasError ? errorId : undefined}
              />
            </div>
            <FormStatus id={errorId} state={submitState} error="Invalid email or password." />
            <Button type="submit" disabled={submitState === 'submitting'} className="w-full">
              {submitState === 'submitting' ? <><Spinner /> Signing in…</> : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthPage>
  );
}

function FormStatus({ error, id, state }: { error: string; id: string; state: SubmitState }) {
  if (state === 'submitting') {
    return <p className="min-h-5 text-sm text-muted-foreground" role="status">Working…</p>;
  }

  if (state === 'error') {
    return (
      <Alert id={id} variant="destructive">
        <AlertCircle className="size-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return <p className="min-h-5" aria-hidden="true">&nbsp;</p>;
}

function ConsoleShell({ context, onLoggedOut }: { context: CurrentContext; onLoggedOut: () => void }) {
  const [route, setRoute] = useState<ConsoleRoute>(() => parseConsoleRoute(window.location.pathname));
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetNavigationFocusTargetRef = useRef<string | null>(null);

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
    setSheetOpen(false);
  }

  function navigateFromSheet(path: string) {
    sheetNavigationFocusTargetRef.current = 'sites-title';
    navigate(path);
  }

  function handleSheetOpenChange(open: boolean) {
    if (open) {
      sheetNavigationFocusTargetRef.current = null;
    }
    setSheetOpen(open);
  }

  function handleSheetCloseAutoFocus(event: Event) {
    const targetId = sheetNavigationFocusTargetRef.current;
    sheetNavigationFocusTargetRef.current = null;
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
  }

  async function handleLogout() {
    await logout();
    replaceConsolePath('/console/login');
    onLoggedOut();
  }

  function handleLogoutClick() {
    void handleLogout();
  }

  const sitesActive = route.page === 'sites' || route.page === 'createSite' || route.page === 'siteDetail' || route.page === 'createWidget' || route.page === 'widgetDetail';

  return (
    <div className="grid min-h-dvh min-w-0 bg-background md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh min-w-0 flex-col border-r bg-sidebar p-3 md:flex" aria-label="Console navigation">
        <ConsoleNavigation context={context} onLogout={handleLogoutClick} onNavigate={navigate} sitesActive={sitesActive} />
      </aside>

      <main className="flex flex-col min-w-0">
        <header className="sticky top-0 z-40 flex h-16 min-w-0 items-center gap-3 bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col w-[min(20rem,85vw)] p-4" onCloseAutoFocus={handleSheetCloseAutoFocus}>
              <SheetTitle>Panda Chat Console</SheetTitle>
              <SheetDescription>Navigation and workspace controls.</SheetDescription>
              <div className="flex flex-col flex-1 mt-4">
                <ConsoleNavigation context={context} onLogout={handleLogoutClick} onNavigate={navigateFromSheet} sitesActive={sitesActive} />
              </div>
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">{context.workspace.name}</p>
            <span className="block truncate text-xs text-muted-foreground md:hidden">Widget console</span>
          </div>
          <span className="hidden max-w-[min(42vw,360px)] truncate text-xs text-muted-foreground sm:block" title={context.user.email}>{context.user.email}</span>
          <div className="pointer-events-none absolute inset-x-0 -bottom-2 h-2 bg-gradient-to-b from-background to-transparent" />
        </header>

        <div className="mx-auto w-full max-w-6xl flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8">
          <ConsoleRouteView route={route} onNavigate={navigate} />
        </div>
      </main>
    </div>
  );
}

export function ConsoleRouteView({ onNavigate, route }: { onNavigate: NavigateHandler; route: ConsoleRoute }) {
  if (route.page === 'sites') return <SiteListPage onNavigate={onNavigate} />;
  if (route.page === 'createSite') return <CreateSitePage onNavigate={onNavigate} />;
  if (route.page === 'siteDetail') return <SiteDetailPage onNavigate={onNavigate} siteId={route.siteId} />;
  if (route.page === 'createWidget') return <CreateWidgetPage onNavigate={onNavigate} siteId={route.siteId} />;
  if (route.page === 'widgetDetail') {
    return (
      <WidgetSettingsPage
        key={JSON.stringify([route.siteId, route.widgetId])}
        onNavigate={onNavigate}
        siteId={route.siteId}
        widgetId={route.widgetId}
      />
    );
  }
  return <NotFoundPage onNavigate={onNavigate} />;
}

/* ---------- Site list ---------- */

type SiteListState =
  | { status: 'loading' }
  | { status: 'ready'; sites: ConsoleSite[] }
  | { status: 'error' };

function SiteListPage({ onNavigate }: { onNavigate: NavigateHandler }) {
  const [state, setState] = useState<SiteListState>({ status: 'loading' });

  useEffect(() => {
    let isCurrent = true;
    async function loadSites() {
      try {
        const sites = await listSites();
        if (isCurrent) setState({ status: 'ready', sites });
      } catch {
        if (isCurrent) setState({ status: 'error' });
      }
    }
    void loadSites();
    return () => { isCurrent = false; };
  }, []);

  return (
    <section className="grid min-w-0 w-full gap-6" aria-labelledby="sites-title">
      <PageHeader
        eyebrow="Workspace"
        title="Sites"
        body="Create a site for each web property that will use a chat widget."
        action={<Button variant="outline" onClick={() => onNavigate('/console/sites/new')}><Plus className="size-4" />New site</Button>}
        titleId="sites-title"
      />
      {state.status === 'loading' ? (
        <Card role="status" aria-live="polite"><CardHeader className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-64" /></CardHeader></Card>
      ) : null}
      {state.status === 'error' ? (
        <Alert variant="destructive" aria-live="assertive"><AlertCircle className="size-4" /><AlertTitle>Sites unavailable</AlertTitle><AlertDescription>Refresh the page and try again.</AlertDescription></Alert>
      ) : null}
      {state.status === 'ready' && state.sites.length === 0 ? (
        <Empty><EmptyTitle>No sites yet</EmptyTitle><EmptyDescription>Create your first site to start organizing widgets for this workspace.</EmptyDescription><Button variant="secondary" onClick={() => onNavigate('/console/sites/new')}>Create site</Button></Empty>
      ) : null}
      {state.status === 'ready' && state.sites.length > 0 ? (
        <Card className="overflow-hidden shadow-none">
          <Table aria-label="Workspace sites">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]">Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                <TableHead className="hidden lg:table-cell">Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.sites.map((site) => (
                <TableRow key={site.id}>
                  <TableCell className="whitespace-normal break-words font-medium">{site.name}</TableCell>
                  <TableCell><Badge variant={site.enabled ? 'secondary' : 'outline'}>{site.enabled ? 'Enabled' : 'Disabled'}</Badge></TableCell>
                  <TableCell className="hidden whitespace-normal text-muted-foreground tabular-nums md:table-cell">{formatDate(site.createdAt)}</TableCell>
                  <TableCell className="hidden whitespace-normal text-muted-foreground tabular-nums lg:table-cell">{formatDate(site.updatedAt)}</TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => onNavigate(`/console/sites/${site.id}`)}>Open <ArrowRight className="size-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </section>
  );
}

/* ---------- Create site ---------- */

function CreateSitePage({ onNavigate }: { onNavigate: NavigateHandler }) {
  const [name, setName] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitState === 'submitting') return;
    setSubmitState('submitting');
    try {
      const site = await createSite({ name });
      onNavigate(`/console/sites/${site.id}`);
    } catch {
      setSubmitState('error');
    }
  }

  const errorId = 'create-site-error';
  const hasError = submitState === 'error';

  return (
    <section className="grid min-w-0 w-full gap-6" aria-labelledby="create-site-title">
      <PageHeader eyebrow="Sites" title="Create site" body="Add a site to this workspace." titleId="create-site-title" />
      <Card className="max-w-[640px] shadow-none">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} aria-busy={submitState === 'submitting'} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="site-name">Site name</Label>
              <Input id="site-name" autoFocus placeholder="Marketing website" value={name} onChange={(event) => setName(event.currentTarget.value)} disabled={submitState === 'submitting'} aria-invalid={hasError || undefined} aria-describedby={hasError ? errorId : undefined} />
            </div>
            <FormStatus id={errorId} state={submitState} error="Site could not be created. Check the name and try again." />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={submitState === 'submitting' || !name.trim()}>Create site</Button>
              <Button variant="ghost" type="button" onClick={() => onNavigate('/console/sites')}><ArrowLeft className="size-4" />Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}


/* ---------- Exported seams for testable page workflows ---------- */

export async function loadSiteDetailPageState(
  siteId: string,
  dependencies: { getSite: typeof getSite; listWidgets: typeof listWidgets },
  isCurrent: () => boolean,
): Promise<SiteDetailState | null> {
  try {
    const [site, widgets] = await Promise.all([dependencies.getSite(siteId), dependencies.listWidgets(siteId)]);
    if (!isCurrent()) return null;
    return { status: 'ready', site, widgets };
  } catch (error) {
    if (!isCurrent()) return null;
    return error instanceof ApiError && error.status === 404 ? { status: 'notFound' } : { status: 'error' };
  }
}

export async function loadCreateWidgetPageState(
  siteId: string,
  dependencies: { getSite: typeof getSite },
  isCurrent: () => boolean,
): Promise<CreateWidgetState | null> {
  try {
    const site = await dependencies.getSite(siteId);
    if (!isCurrent()) return null;
    return { status: 'ready', site };
  } catch (error) {
    if (!isCurrent()) return null;
    return error instanceof ApiError && error.status === 404 ? { status: 'notFound' } : { status: 'error' };
  }
}

export async function submitCreateWidgetPage(
  siteId: string,
  name: string,
  dependencies: { createWidget: typeof createWidget },
  onNavigate: NavigateHandler,
): Promise<'created' | 'notFound' | 'error'> {
  try {
    await dependencies.createWidget(siteId, { name });
    onNavigate(`/console/sites/${siteId}`);
    return 'created';
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return 'notFound';
    return 'error';
  }
}

/* ---------- Site detail ---------- */

export type SiteDetailState =
  | { status: 'loading' }
  | { status: 'ready'; site: ConsoleSite; widgets: ConsoleWidget[] }
  | { status: 'notFound' }
  | { status: 'error' };

function SiteDetailPage({ onNavigate, siteId }: { onNavigate: NavigateHandler; siteId: string }) {
  const [state, setState] = useState<SiteDetailState>({ status: 'loading' });

  useEffect(() => {
    let isCurrent = true;
    setState({ status: 'loading' });
    void loadSiteDetailPageState(siteId, { getSite, listWidgets }, () => isCurrent).then((result) => {
      if (result) setState(result);
    });
    return () => { isCurrent = false; };
  }, [siteId]);

  if (state.status === 'loading') {
    return <Card role="status" aria-live="polite"><CardHeader className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-6 w-48" /></CardHeader></Card>;
  }

  if (state.status === 'notFound') {
    return <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Site not found</AlertTitle><AlertDescription>This site is not available in the current workspace.</AlertDescription></Alert>;
  }

  if (state.status === 'error') {
    return <Alert variant="destructive" aria-live="assertive"><AlertCircle className="size-4" /><AlertTitle>Site unavailable</AlertTitle><AlertDescription>Refresh the page and try again.</AlertDescription></Alert>;
  }

  return (
    <section className="grid min-w-0 w-full gap-6" aria-labelledby="site-detail-title">
      <PageHeader
        eyebrow="Site detail"
        title={state.site.name}
        body="Create and review widgets for this site."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onNavigate(`/console/sites/${state.site.id}/widgets/new`)}><Plus className="size-4" />New widget</Button>
            <Button variant="ghost" onClick={() => onNavigate('/console/sites')}><ArrowLeft className="size-4" />All sites</Button>
          </div>
        }
        titleId="site-detail-title"
      />
      {state.widgets.length === 0 ? (
        <Empty><EmptyTitle>No widgets yet</EmptyTitle><EmptyDescription>Create a widget for this site to generate its public key.</EmptyDescription><Button variant="secondary" onClick={() => onNavigate(`/console/sites/${state.site.id}/widgets/new`)}>Create widget</Button></Empty>
      ) : (
        <Card className="overflow-hidden shadow-none" aria-label="Site widgets">
          {state.widgets.map((widget, i) => (
            <button className={`flex min-w-0 w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/60 ${i < state.widgets.length - 1 ? 'border-b' : ''}`} key={widget.id} type="button" onClick={() => onNavigate(`/console/sites/${state.site.id}/widgets/${widget.id}`)}>
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted" aria-hidden="true"><Sparkles className="size-4" /></span>
              <span className="min-w-0 flex-1"><strong className="block break-words text-sm font-medium">{widget.name}</strong><code className="block truncate text-xs text-muted-foreground">{widget.publicKey}</code></span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
        </Card>
      )}
    </section>
  );
}

/* ---------- Create widget ---------- */

export type CreateWidgetState =
  | { status: 'loading' }
  | { status: 'ready'; site: ConsoleSite }
  | { status: 'notFound' }
  | { status: 'error' };

function CreateWidgetPage({ onNavigate, siteId }: { onNavigate: NavigateHandler; siteId: string }) {
  const [state, setState] = useState<CreateWidgetState>({ status: 'loading' });
  const [name, setName] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');

  useEffect(() => {
    let isCurrent = true;
    setState({ status: 'loading' });
    void loadCreateWidgetPageState(siteId, { getSite }, () => isCurrent).then((result) => {
      if (result) setState(result);
    });
    return () => { isCurrent = false; };
  }, [siteId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitState === 'submitting') return;
    setSubmitState('submitting');
    const result = await submitCreateWidgetPage(siteId, name, { createWidget }, onNavigate);
    if (result === 'notFound') setState({ status: 'notFound' });
    else if (result === 'error') setSubmitState('error');
  }

  if (state.status === 'loading') {
    return <Card role="status" aria-live="polite"><CardHeader className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-6 w-48" /></CardHeader></Card>;
  }

  if (state.status === 'notFound') {
    return <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Site not found</AlertTitle><AlertDescription>This site is not available in the current workspace.</AlertDescription></Alert>;
  }

  if (state.status === 'error') {
    return <Alert variant="destructive" aria-live="assertive"><AlertCircle className="size-4" /><AlertTitle>Site unavailable</AlertTitle><AlertDescription>Refresh the page and try again.</AlertDescription></Alert>;
  }

  const errorId = 'create-widget-error';
  const hasError = submitState === 'error';

  return (
    <section className="grid min-w-0 w-full gap-6" aria-labelledby="create-widget-title">
      <PageHeader eyebrow="Widgets" title="Create widget" body={`Add a widget for ${state.site.name}.`} titleId="create-widget-title" />
      <Card className="max-w-[640px] shadow-none">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} aria-busy={submitState === 'submitting'} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="widget-name">Widget name</Label>
              <Input id="widget-name" autoFocus placeholder="Support widget" value={name} onChange={(event) => setName(event.currentTarget.value)} disabled={submitState === 'submitting'} aria-invalid={hasError || undefined} aria-describedby={hasError ? errorId : undefined} />
            </div>
            <FormStatus id={errorId} state={submitState} error="Widget could not be created. Check the name and try again." />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={submitState === 'submitting' || !name.trim()}>Create widget</Button>
              <Button variant="ghost" type="button" onClick={() => onNavigate(`/console/sites/${siteId}`)}><ArrowLeft className="size-4" />Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}

/* ---------- Shared ---------- */

function NotFoundPage({ onNavigate }: { onNavigate: NavigateHandler }) {
  return (
    <Alert role="alert" className="max-w-[760px]">
      <AlertCircle className="size-4" />
      <AlertTitle>Console page not found</AlertTitle>
      <AlertDescription>Open the site list to continue managing this workspace.</AlertDescription>
      <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={() => onNavigate('/console/sites')}>View sites</Button>
    </Alert>
  );
}

export function parseConsoleRoute(pathname: string): ConsoleRoute {
  const pathnameWithoutTrailingSlash = pathname.replace(/\/+$/, '') || '/console';
  const segments = pathnameWithoutTrailingSlash.split('/').filter(Boolean).map(decodePathSegment);
  if (segments[0] !== 'console') return { page: 'notFound' };
  if (segments.length === 1) return { page: 'sites' };
  if (segments[1] !== 'sites') return { page: 'notFound' };
  if (segments.length === 2) return { page: 'sites' };
  if (segments.length === 3 && segments[2] === 'new') return { page: 'createSite' };
  if (segments.length === 3 && segments[2]) return { page: 'siteDetail', siteId: segments[2] };
  if (segments.length === 5 && segments[2] && segments[3] === 'widgets' && segments[4] === 'new') return { page: 'createWidget', siteId: segments[2] };
  if (segments.length === 5 && segments[2] && segments[3] === 'widgets' && segments[4]) return { page: 'widgetDetail', siteId: segments[2], widgetId: segments[4] };
  return { page: 'notFound' };
}

function decodePathSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
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
