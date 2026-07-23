import { type FormEvent, useEffect, useReducer, useRef, useState } from 'react';
import {
  ApiError,
  createWidgetDomain,
  deleteWidgetDomain,
  getWidgetSettings,
  listWidgetDomains,
  updateWidgetSettings,
  type ConsoleWidgetNextLocalReplyCandidate,
  type ConsoleWidgetSettings,
  type UpdateWidgetSettingsInput,
} from './console-api';
import {
  createLocalManualReplyState,
  reduceLocalManualReplyState,
  type LocalManualReplyScope,
} from './local-manual-reply-command';
import {
  copyLocalManualReplyCommand,
  loadLocalDiagnostics,
  localManualReplyStateForScope,
  mergeLocalDiagnostics,
  nextLocalReplyCandidateDetails,
  subscribeLocalManualReplyCopy,
  type WidgetSettingsState,
} from './widget-settings-helpers';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

type SubmitState = 'idle' | 'submitting' | 'error';

type WidgetSettingsForm = {
  name: string;
  assistantDisplayName: string;
  launcherLabel: string;
  welcomeTitle: string;
  welcomeSubtitle: string;
  colorMode: 'light' | 'dark' | 'system';
};

type NavigateHandler = (path: string) => void;

export function WidgetSettingsPage({
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
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [copiedTargetId, setCopiedTargetId] = useState<string | null>(null);
  const [domainPendingDeleteId, setDomainPendingDeleteId] = useState<string | null>(null);
  const currentWidgetRef = useRef({ siteId, widgetId });
  const currentCandidateIdRef = useRef<string | null>(null);
  const currentCandidateId =
    state.status === 'ready' ? (state.settings.connection.localDelivery.nextLocalReplyCandidate?.id ?? null) : null;
  const currentLocalManualReplyScope: LocalManualReplyScope = { siteId, widgetId, candidateId: currentCandidateId };
  const [localManualReplyState, dispatchLocalManualReply] = useReducer(
    reduceLocalManualReplyState,
    currentLocalManualReplyScope,
    createLocalManualReplyState,
  );
  const localManualReply = localManualReplyStateForScope(localManualReplyState, currentLocalManualReplyScope);
  currentWidgetRef.current = { siteId, widgetId };
  currentCandidateIdRef.current = currentCandidateId;

  function observeLocalManualReplyCandidate(candidateId: string | null) {
    dispatchLocalManualReply({ type: 'scopeChanged', scope: { siteId, widgetId, candidateId } });
  }

  useEffect(() => subscribeLocalManualReplyCopy(dispatchLocalManualReply), []);

  useEffect(() => {
    let isCurrent = true;

    async function loadWidgetSettings() {
      try {
        const [settings, domains] = await Promise.all([
          getWidgetSettings(siteId, widgetId),
          listWidgetDomains(siteId, widgetId),
        ]);

        if (isCurrent) {
          observeLocalManualReplyCandidate(settings.connection.localDelivery.nextLocalReplyCandidate?.id ?? null);
          setState({ status: 'ready', settings, domains });
          setForm(formFromSettings(settings));
          setConnectionDraft(settings.connection.routeHandle ?? '');
          setCopiedSnippet(null);
          setCopiedTargetId(null);
          setDomainPendingDeleteId(null);
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
    observeLocalManualReplyCandidate(settings.connection.localDelivery.nextLocalReplyCandidate?.id ?? null);
    setState({ status: 'ready', settings, domains });
    setForm(formFromSettings(settings));
    setConnectionDraft(settings.connection.routeHandle ?? '');
    setCopiedSnippet(null);
    setCopiedTargetId(null);
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
      observeLocalManualReplyCandidate(settings.connection.localDelivery.nextLocalReplyCandidate?.id ?? null);

      if (state.status === 'ready') {
        setState({ status: 'ready', settings, domains: state.domains });
      }

      setForm(formFromSettings(settings));
      setSubmitState('idle');
      toast.success('Widget settings saved');
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
      observeLocalManualReplyCandidate(settings.connection.localDelivery.nextLocalReplyCandidate?.id ?? null);

      if (state.status === 'ready') {
        setState({ status: 'ready', settings, domains: state.domains });
      }

      setConnectionDraft(settings.connection.routeHandle ?? '');
      setConnectionSubmitState('idle');
      toast.success('Connection placeholder saved');
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
      observeLocalManualReplyCandidate(settings.connection.localDelivery.nextLocalReplyCandidate?.id ?? null);

      if (state.status === 'ready') {
        setState({ status: 'ready', settings, domains: state.domains });
      }

      setConnectionDraft('');
      setConnectionSubmitState('idle');
      toast.success('Connection placeholder cleared');
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
      toast.success('Allowed domain added');
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
      setDomainPendingDeleteId(null);
      toast.success('Allowed domain deleted');
    } catch (error) {
      setDomainPendingDeleteId(null);
      if (error instanceof ApiError && error.status === 404) {
        setState({ status: 'notFound' });
      } else {
        setDomainSubmitState('error');
      }
    }
  }

  async function handleLocalDiagnosticsRefresh() {
    setDiagnosticsRefreshState('submitting');
    const result = await loadLocalDiagnostics(
      siteId, widgetId, currentCandidateIdRef.current,
      {
        getWidgetSettings,
        isCurrent: () => currentWidgetRef.current.siteId === siteId && currentWidgetRef.current.widgetId === widgetId,
      },
    );
    if (result.status === 'stale') return;
    if (result.status === 'error') { setDiagnosticsRefreshState('error'); return; }
    if (result.candidateChanged) setCopiedTargetId(null);
    observeLocalManualReplyCandidate(result.localDelivery.nextLocalReplyCandidate?.id ?? null);
    setState((currentState) => mergeLocalDiagnostics(currentState, result.localDelivery));
    setDiagnosticsRefreshState('idle');
  }

  async function copyText(value: string, onCopied: () => void, successMessage: string) {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      onCopied();
      toast.success(successMessage);
    } catch {
      toast.error('Copy failed. Select the text and copy it manually.');
    }
  }

  function handleCopySnippet(snippet: string) {
    void copyText(snippet, () => setCopiedSnippet(snippet), 'Install snippet copied');
  }

  function handleCopyNextLocalReplyTarget(intentId: string) {
    void copyText(intentId, () => setCopiedTargetId(intentId), 'Target ID copied');
  }

  function handleCopyLocalManualReplyCommand(command: string) {
    void copyLocalManualReplyCommand(command, () => navigator.clipboard).then((copied) => {
      if (copied) toast.success('Reply command copied');
      else toast.error('Copy failed. Select the command and copy it manually.');
    });
  }

  if (state.status === 'loading') {
    return (
      <Card className="w-full max-w-[940px]" role="status" aria-live="polite">
        <CardHeader className="space-y-2">
          <span className="sr-only">Loading widget settings…</span>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
      </Card>
    );
  }

  if (state.status === 'notFound') {
    return (
      <Alert variant="destructive" className="max-w-[940px]">
        <AlertCircle className="size-4" />
        <AlertTitle>Widget not found</AlertTitle>
        <AlertDescription>This widget is not available in the current workspace.</AlertDescription>
      </Alert>
    );
  }

  if (state.status === 'error' || !form) {
    return (
      <Alert variant="destructive" aria-live="assertive" className="max-w-[940px]">
        <AlertCircle className="size-4" />
        <AlertTitle>Widget settings unavailable</AlertTitle>
        <AlertDescription>Refresh the page and try again.</AlertDescription>
      </Alert>
    );
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
  const localManualReplyCommand = localManualReply.command;

  return (
    <section className="grid gap-4 min-w-0 w-full max-w-[940px]" aria-labelledby="widget-settings-title">
      <div className="flex flex-col gap-4 min-w-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-wider text-primary">Widget settings</p>
          <h2 id="widget-settings-title" className="text-xl font-bold md:text-2xl break-words" tabIndex={-1}>{state.settings.widget.name}</h2>
          <p className="text-sm text-muted-foreground">Manage safe widget copy, allowed domains, and the install snippet for this public key.</p>
        </div>
        <div className="shrink-0">
          <Button variant="outline" type="button" onClick={() => onNavigate(`/console/sites/${siteId}`)}>Back to site</Button>
        </div>
      </div>

      <Card aria-labelledby="widget-public-key-title">
        <CardHeader className="space-y-2">
          <p className="text-xs font-extrabold uppercase tracking-wider text-primary">Public key</p>
          <h3 id="widget-public-key-title" className="font-semibold leading-none tracking-tight">Server-owned key</h3>
          <CardDescription>Use this public key only in the loader snippet. It is safe to publish on allowed domains.</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block min-w-0 max-w-full rounded-md bg-muted px-2 py-1 text-xs font-mono break-all">{state.settings.widget.publicKey}</code>
        </CardContent>
      </Card>

      <Tabs defaultValue="copy">
        <TabsList className="grid h-auto w-full grid-cols-2 sm:w-fit sm:grid-cols-4" aria-label="Widget settings sections">
          <TabsTrigger value="copy">Copy</TabsTrigger>
          <TabsTrigger value="connection">Connection</TabsTrigger>
          <TabsTrigger value="domains">Domains</TabsTrigger>
          <TabsTrigger value="install">Install</TabsTrigger>
        </TabsList>

        <TabsContent value="copy">
          <Card>
            <form onSubmit={handleSettingsSubmit} aria-busy={submitState === 'submitting'}>
              <CardHeader className="space-y-2">
                <p className="text-xs font-extrabold uppercase tracking-wider text-primary">Safe config</p>
                <h3 className="font-semibold leading-none tracking-tight">Widget copy</h3>
                <CardDescription>Only plain text and existing theme tokens are supported here.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="widget-settings-name">Widget name</FieldLabel>
                    <Input id="widget-settings-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} disabled={submitState === 'submitting'} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="widget-settings-assistant">Assistant display name</FieldLabel>
                    <Input id="widget-settings-assistant" value={form.assistantDisplayName} onChange={(event) => setForm({ ...form, assistantDisplayName: event.currentTarget.value })} disabled={submitState === 'submitting'} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="widget-settings-launcher">Launcher label</FieldLabel>
                    <Input id="widget-settings-launcher" value={form.launcherLabel} onChange={(event) => setForm({ ...form, launcherLabel: event.currentTarget.value })} disabled={submitState === 'submitting'} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="widget-settings-color-mode">Theme color mode</FieldLabel>
                    <Select value={form.colorMode} onValueChange={(colorMode: WidgetSettingsForm['colorMode']) => setForm({ ...form, colorMode })} disabled={submitState === 'submitting'}>
                      <SelectTrigger id="widget-settings-color-mode" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="system">System</SelectItem>
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="dark">Dark</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldDescription>Choose whether the widget follows the visitor device or uses a fixed theme.</FieldDescription>
                  </Field>
                  <Field className="sm:col-span-2">
                    <FieldLabel htmlFor="widget-settings-title-input">Welcome title</FieldLabel>
                    <Input id="widget-settings-title-input" value={form.welcomeTitle} onChange={(event) => setForm({ ...form, welcomeTitle: event.currentTarget.value })} disabled={submitState === 'submitting'} />
                  </Field>
                  <Field className="sm:col-span-2">
                    <FieldLabel htmlFor="widget-settings-subtitle">Welcome subtitle</FieldLabel>
                    <Textarea id="widget-settings-subtitle" value={form.welcomeSubtitle} onChange={(event) => setForm({ ...form, welcomeSubtitle: event.currentTarget.value })} disabled={submitState === 'submitting'} />
                    <FieldDescription>Shown beneath the welcome title before the visitor starts chatting.</FieldDescription>
                  </Field>
                </FieldGroup>
                <FormStatus id="widget-settings-error" state={submitState} error="Settings could not be saved. Check the plain text fields and try again." />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={submitState === 'submitting' || !canSaveSettings}>Save settings</Button>
                </div>
              </CardContent>
            </form>
          </Card>
        </TabsContent>

        <TabsContent value="connection">
          <Card aria-labelledby="panda-connection-title" aria-busy={diagnosticsRefreshState === 'submitting'}>
            <CardHeader className="space-y-2">
              <p className="text-xs font-extrabold uppercase tracking-wider text-primary">Panda connection</p>
              <h3 id="panda-connection-title" className="font-semibold leading-none tracking-tight">Connection placeholder</h3>
              <CardDescription>Owner-only local deterministic fake reply diagnostic. It shows queued and claimed local future-dispatch intents plus fake reply rows applied locally; Gateway/CLI dispatch is not connected yet, so visitor messages still use the local fake reply loop.</CardDescription>
              <CardDescription>Manual local/demo-only diagnostics refreshes re-fetch the owner widget settings endpoint without saving drafts or reloading the page.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1">
                <Badge variant="secondary">{formatConnectionStatus(state.settings.connection.status)}</Badge>
                <small className="text-xs text-muted-foreground">{state.settings.connection.routeHandle ? 'A placeholder route handle is saved.' : 'No route handle is saved yet.'}</small>
                <small className="text-xs text-muted-foreground">{formatLocalDeliveryStatus(state.settings.connection.localDelivery)}</small>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" type="button" onClick={() => void handleLocalDiagnosticsRefresh()} disabled={diagnosticsRefreshState === 'submitting'}>
                  {diagnosticsRefreshState === 'submitting' ? <><Spinner /> Refreshing local diagnostics…</> : 'Refresh local diagnostics'}
                </Button>
              </div>
              <FormStatus id="widget-diagnostics-error" state={diagnosticsRefreshState} error="Local diagnostics could not be refreshed. Unsaved widget copy and route handle drafts were kept; try again." />
              {nextLocalReplyCandidate ? (
                <div className="grid gap-4 rounded-lg border p-4 min-w-0" aria-label="Next local manual reply target">
                  <div className="flex flex-wrap items-center justify-between gap-4 min-w-0">
                    <span className="grid gap-1 min-w-0">
                      <strong className="text-sm">next manual reply target ID</strong>
                      <code className="min-w-0 max-w-full rounded-md bg-muted px-2 py-1 text-xs font-mono break-all">{nextLocalReplyCandidate.id}</code>
                      <small className="text-xs text-muted-foreground">Local-only targetIntentId for local-panda:reply-manual.</small>
                    </span>
                    <Button variant="outline" type="button" onClick={() => handleCopyNextLocalReplyTarget(nextLocalReplyCandidate.id)}>
                      {copiedTargetId === nextLocalReplyCandidate.id ? 'Copied' : 'Copy target ID'}
                    </Button>
                  </div>
                  <NextLocalReplyCandidateDetails candidate={nextLocalReplyCandidate} />
                  <Separator />
                  <div className="grid gap-2 min-w-0">
                    <strong className="text-sm">Targeted local manual reply command</strong>
                    <div className="grid gap-2">
                      <Label htmlFor="local-manual-reply-text">Local manual reply text</Label>
                      <Textarea id="local-manual-reply-text" aria-describedby="local-manual-reply-guidance" value={localManualReply.draft} onChange={(event) => dispatchLocalManualReply({ type: 'draftChanged', draft: event.currentTarget.value })} />
                    </div>
                    {localManualReplyCommand ? (
                      <pre className="min-w-0 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs font-mono" aria-label="Targeted local manual reply command"><code>{localManualReplyCommand}</code></pre>
                    ) : null}
                    <p id="local-manual-reply-guidance" className={localManualReplyCommand && localManualReply.copyErrorCommand === localManualReplyCommand ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'} role="status" aria-live="polite">
                      {!localManualReplyCommand ? 'Enter reply text to generate a command.' : localManualReply.copyErrorCommand === localManualReplyCommand ? 'Copy failed; select the command manually.' : 'Copy this command and run it manually in a local terminal.'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" type="button" disabled={!localManualReplyCommand} onClick={() => localManualReplyCommand && void handleCopyLocalManualReplyCommand(localManualReplyCommand)}>
                        {localManualReply.copiedCommand === localManualReplyCommand && localManualReplyCommand ? 'Copied' : 'Copy reply command'}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <Empty aria-label="No next local manual reply target">
                  <EmptyTitle>No next manual reply target ID</EmptyTitle>
                  <EmptyDescription>Send a visitor message or leave a claimed local intent unapplied to show the next local-only target.</EmptyDescription>
                </Empty>
              )}
              <Separator />
              <form className="flex flex-wrap items-end gap-2" onSubmit={handleConnectionSubmit} aria-busy={connectionSubmitState === 'submitting'}>
                <div className="grid gap-2 min-w-0 flex-1 basis-56">
                  <Label htmlFor="widget-connection-route-handle">Route handle</Label>
                  <Input id="widget-connection-route-handle" placeholder="panda:workspace/route" value={connectionDraft} onChange={(event) => setConnectionDraft(event.currentTarget.value)} disabled={connectionSubmitState === 'submitting'} />
                </div>
                <Button type="submit" disabled={connectionSubmitState === 'submitting' || !connectionDraft.trim()}>Save placeholder</Button>
              </form>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" type="button" onClick={() => void handleConnectionClear()} disabled={connectionSubmitState === 'submitting' || (!state.settings.connection.routeHandle && !connectionDraft.trim())}>Clear connection</Button>
              </div>
              <FormStatus id="widget-connection-error" state={connectionSubmitState} error="Panda connection placeholder could not be saved. Check the route handle and try again." />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="domains">
          <Card aria-labelledby="allowed-domains-title">
            <CardHeader className="space-y-2">
              <p className="text-xs font-extrabold uppercase tracking-wider text-primary">Allowed domains</p>
              <h3 id="allowed-domains-title" className="font-semibold leading-none tracking-tight">Allowed domains</h3>
              <CardDescription>Add each hostname where this widget may bootstrap. Ports are ignored for schemeful origins.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {state.domains.length === 0 ? (
                <Empty>
                  <EmptyTitle>No allowed domains yet</EmptyTitle>
                  <EmptyDescription>Add an allowed domain before installing this widget on a website.</EmptyDescription>
                  <Button variant="secondary" type="button" onClick={() => document.getElementById('widget-domain-input')?.focus()}>Focus domain field</Button>
                </Empty>
              ) : (
                <div className="overflow-hidden rounded-lg border" aria-label="Allowed widget domains">
                  {state.domains.map((domain, i) => (
                    <div className={`flex items-center justify-between gap-4 p-4 min-w-0 ${i < state.domains.length - 1 ? 'border-b' : ''}`} key={domain.id}>
                      <span className="min-w-0">
                        <strong className="block break-words">{domain.domain}</strong>
                        <small className="text-muted-foreground text-xs">Created {formatDate(domain.createdAt)}</small>
                      </span>
                      <Dialog open={domainPendingDeleteId === domain.id} onOpenChange={(open) => setDomainPendingDeleteId(open ? domain.id : null)}>
                        <DialogTrigger asChild>
                          <Button variant="outline" type="button" disabled={domainSubmitState === 'submitting'}>Delete</Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Delete allowed domain?</DialogTitle>
                            <DialogDescription>Remove {domain.domain} from this widget’s allowed domains. The widget will no longer bootstrap on this hostname.</DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose asChild><Button variant="outline" type="button" disabled={domainSubmitState === 'submitting'}>Cancel</Button></DialogClose>
                            <Button variant="destructive" type="button" onClick={() => void handleDeleteDomain(domain.id)} disabled={domainSubmitState === 'submitting'}>
                              {domainSubmitState === 'submitting' ? <><Spinner /> Delete domain</> : 'Delete domain'}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  ))}
                </div>
              )}
              <Separator />
              <form className="flex flex-wrap items-end gap-2" onSubmit={handleDomainSubmit} aria-busy={domainSubmitState === 'submitting'}>
                <div className="grid gap-2 min-w-0 flex-1 basis-56">
                  <Label htmlFor="widget-domain-input">Domain or origin</Label>
                  <Input id="widget-domain-input" placeholder="example.com or https://example.com" value={domainDraft} onChange={(event) => setDomainDraft(event.currentTarget.value)} disabled={domainSubmitState === 'submitting'} />
                </div>
                <Button type="submit" disabled={domainSubmitState === 'submitting' || !domainDraft.trim()}>Add domain</Button>
              </form>
              <FormStatus id="widget-domain-error" state={domainSubmitState} error="Domain could not be updated. Check the hostname and try again." />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="install">
          <Card aria-labelledby="install-snippet-title">
            <CardHeader className="space-y-2">
              <p className="text-xs font-extrabold uppercase tracking-wider text-primary">Install snippet</p>
              <h3 id="install-snippet-title" className="font-semibold leading-none tracking-tight">Copy loader snippet</h3>
              <CardDescription>The snippet appears after at least one allowed domain exists.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {hasSnippet ? (
                <>
                  <Textarea className="min-h-32 font-mono text-xs" readOnly value={snippet} aria-label="Install snippet" />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" type="button" onClick={() => handleCopySnippet(snippet)}>{copiedSnippet === snippet ? 'Copied' : 'Copy snippet'}</Button>
                  </div>
                </>
              ) : (
                <Alert>
                  <AlertCircle className="size-4" />
                  <AlertTitle>Snippet locked</AlertTitle>
                  <AlertDescription>Add an allowed domain to generate the install snippet.</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </section>
  );
}

function NextLocalReplyCandidateDetails({ candidate }: { candidate: ConsoleWidgetNextLocalReplyCandidate }) {
  const details = nextLocalReplyCandidateDetails(candidate);
  return (
    <dl className="grid gap-2 sm:grid-cols-2" aria-label="Next local reply candidate details">
      {details.map(({ label, value }) => (
        <div className="grid gap-1 min-w-0" key={label}>
          <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
          <dd className="min-w-0"><code className="min-w-0 max-w-full rounded-md bg-muted px-2 py-1 text-xs font-mono break-all">{value}</code></dd>
        </div>
      ))}
    </dl>
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

function formatConnectionStatus(status: ConsoleWidgetSettings['connection']['status']): string {
  return status === 'configured_placeholder' ? 'Configured placeholder' : 'Not configured';
}

function formatLocalDeliveryStatus(localDelivery: ConsoleWidgetSettings['connection']['localDelivery']): string {
  const queued = localDelivery.queuedIntentCount === 1 ? '1 queued intent' : `${localDelivery.queuedIntentCount} queued intents`;
  const claimed = localDelivery.claimedIntentCount === 1 ? '1 intent claimed locally' : `${localDelivery.claimedIntentCount} intents claimed locally`;
  const applied = localDelivery.appliedLocalReplyCount === 1 ? '1 fake reply application' : `${localDelivery.appliedLocalReplyCount} fake reply applications`;
  const lastQueued = localDelivery.lastQueuedAt ? `last queued ${formatDate(localDelivery.lastQueuedAt)}` : 'last queued never';
  const lastClaimed = localDelivery.lastClaimedAt ? `last claimed locally ${formatDate(localDelivery.lastClaimedAt)}` : localDelivery.claimedIntentCount > 0 ? 'last claimed timestamp unavailable' : 'last claimed locally never';
  const lastApplied = localDelivery.lastAppliedLocalReplyAt ? `last applied locally ${formatDate(localDelivery.lastAppliedLocalReplyAt)}` : localDelivery.appliedLocalReplyCount > 0 ? 'last applied timestamp unavailable' : 'last applied locally never';
  return `Local deterministic fake reply diagnostic. Local future-dispatch queue: ${queued}; ${lastQueued}. Claimed locally: ${claimed}; ${lastClaimed}. Applied locally: ${applied}; ${lastApplied}.`;
}

function formFromSettings(settings: ConsoleWidgetSettings): WidgetSettingsForm {
  return { name: settings.widget.name, assistantDisplayName: settings.config.assistant.displayName, launcherLabel: settings.config.launcher.label, welcomeTitle: settings.config.welcome.title, welcomeSubtitle: settings.config.welcome.subtitle, colorMode: settings.config.theme.colorMode };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
