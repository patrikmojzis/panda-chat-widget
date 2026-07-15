/**
 * WidgetSettingsLegacyCompatibility
 *
 * Temporary compatibility wrapper for the widget settings page.
 * Root class: .widget-settings-legacy-compat
 * Stylesheet: src/compat/widget-settings-legacy-compat.css
 *
 * Only WidgetSettingsLegacyCompatibility may render/import/consume this layer.
 * S4 deletes this entire file and its stylesheet.
 */

import { type FormEvent, useEffect, useReducer, useRef, useState } from 'react';
import {
  ApiError,
  createWidgetDomain,
  deleteWidgetDomain,
  getWidgetSettings,
  listWidgetDomains,
  updateWidgetSettings,
  type ConsoleAllowedDomain,
  type ConsoleWidgetNextLocalReplyCandidate,
  type ConsoleWidgetSettings,
  type UpdateWidgetSettingsInput,
} from '../console-api';
import {
  createLocalManualReplyState,
  localManualReplyCopyCoordinator,
  reduceLocalManualReplyState,
  type LocalManualReplyScope,
} from '../local-manual-reply-command';
import './widget-settings-legacy-compat.css';

type SubmitState = 'idle' | 'submitting' | 'error';

type WidgetSettingsForm = {
  name: string;
  assistantDisplayName: string;
  launcherLabel: string;
  welcomeTitle: string;
  welcomeSubtitle: string;
  colorMode: 'light' | 'dark' | 'system';
};

export type WidgetSettingsState =
  | { status: 'loading' }
  | { status: 'ready'; settings: ConsoleWidgetSettings; domains: ConsoleAllowedDomain[] }
  | { status: 'notFound' }
  | { status: 'error' };

type NavigateHandler = (path: string) => void;

// Exact frozen DTO field tuple with type-level enforcement
type ExactKeys<T, K extends readonly (keyof T)[]> =
  Exclude<keyof T, K[number]> extends never ? (Exclude<K[number], keyof T> extends never ? K : never) : never;
export const NEXT_LOCAL_REPLY_CANDIDATE_FIELDS: ExactKeys<
  ConsoleWidgetNextLocalReplyCandidate,
  readonly ['id', 'status', 'conversationId', 'visitorMessageId', 'clientMessageId', 'createdAt', 'claimedAt']
> = ['id', 'status', 'conversationId', 'visitorMessageId', 'clientMessageId', 'createdAt', 'claimedAt'] as const;

export type CandidateDetailPair = { label: string; value: string };

export function nextLocalReplyCandidateDetails(candidate: ConsoleWidgetNextLocalReplyCandidate): CandidateDetailPair[] {
  return [
    { label: 'status', value: candidate.status },
    { label: 'conversationId', value: candidate.conversationId },
    { label: 'visitorMessageId', value: candidate.visitorMessageId },
    { label: 'clientMessageId', value: candidate.clientMessageId },
    { label: 'createdAt', value: candidate.createdAt },
    { label: 'claimedAt', value: candidate.claimedAt ?? 'not claimed yet' },
  ];
}

export function localManualReplyStateForScope(
  state: ReturnType<typeof createLocalManualReplyState>,
  scope: LocalManualReplyScope,
): ReturnType<typeof createLocalManualReplyState> {
  return state.scope.siteId === scope.siteId &&
    state.scope.widgetId === scope.widgetId &&
    state.scope.candidateId === scope.candidateId
    ? state
    : createLocalManualReplyState(scope);
}

export function subscribeLocalManualReplyCopy(
  dispatch: Parameters<typeof localManualReplyCopyCoordinator.subscribe>[0],
  coordinator = localManualReplyCopyCoordinator,
): () => void {
  return coordinator.subscribe(dispatch);
}

export function copyLocalManualReplyCommand(
  command: string,
  getClipboard: () => Clipboard,
  coordinator = localManualReplyCopyCoordinator,
): Promise<boolean> {
  return coordinator.copy(command, getClipboard);
}

export type LocalDiagnosticsResult =
  | { status: 'ready'; localDelivery: ConsoleWidgetSettings['connection']['localDelivery']; candidateChanged: boolean }
  | { status: 'stale' }
  | { status: 'error' };

export async function loadLocalDiagnostics(
  siteId: string,
  widgetId: string,
  currentCandidateId: string | null,
  dependencies: { getWidgetSettings: typeof getWidgetSettings; isCurrent: () => boolean },
): Promise<LocalDiagnosticsResult> {
  try {
    const refreshedSettings = await dependencies.getWidgetSettings(siteId, widgetId);
    if (!dependencies.isCurrent()) return { status: 'stale' };
    const localDelivery = refreshedSettings.connection.localDelivery;
    const candidateChanged = (localDelivery.nextLocalReplyCandidate?.id ?? null) !== currentCandidateId;
    return { status: 'ready', localDelivery, candidateChanged };
  } catch {
    if (!dependencies.isCurrent()) return { status: 'stale' };
    return { status: 'error' };
  }
}

export function mergeLocalDiagnostics(
  state: WidgetSettingsState,
  localDelivery: ConsoleWidgetSettings['connection']['localDelivery'],
): WidgetSettingsState {
  if (state.status !== 'ready') return state;
  return {
    ...state,
    settings: {
      ...state.settings,
      connection: {
        ...state.settings.connection,
        localDelivery,
      },
    },
  };
}


export function WidgetSettingsLegacyCompatibility({
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
    observeLocalManualReplyCandidate(settings.connection.localDelivery.nextLocalReplyCandidate?.id ?? null);
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
      observeLocalManualReplyCandidate(settings.connection.localDelivery.nextLocalReplyCandidate?.id ?? null);

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
      observeLocalManualReplyCandidate(settings.connection.localDelivery.nextLocalReplyCandidate?.id ?? null);

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
      observeLocalManualReplyCandidate(settings.connection.localDelivery.nextLocalReplyCandidate?.id ?? null);

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
    if (result.candidateChanged) setTargetCopyState('idle');
    observeLocalManualReplyCandidate(result.localDelivery.nextLocalReplyCandidate?.id ?? null);
    setState((currentState) => mergeLocalDiagnostics(currentState, result.localDelivery));
    setDiagnosticsRefreshState('idle');
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

  function handleCopyLocalManualReplyCommand(command: string) {
    copyLocalManualReplyCommand(command, () => navigator.clipboard);
  }

  if (state.status === 'loading') {
    return <WidgetSettingsLegacyWrapper><LegacyInlineState title="Loading widget settings…" body="Fetching safe settings, allowed domains, and install status." /></WidgetSettingsLegacyWrapper>;
  }

  if (state.status === 'notFound') {
    return <WidgetSettingsLegacyWrapper><LegacyInlineState tone="error" title="Widget not found" body="This widget is not available in the current workspace." /></WidgetSettingsLegacyWrapper>;
  }

  if (state.status === 'error' || !form) {
    return <WidgetSettingsLegacyWrapper><LegacyInlineState tone="error" title="Widget settings unavailable" body="Refresh the page and try again." /></WidgetSettingsLegacyWrapper>;
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
    <WidgetSettingsLegacyWrapper>
      <section className="content-section" aria-labelledby="widget-settings-title">
        <div className="page-header">
          <div className="min-w-0">
            <p className="eyebrow">Widget settings</p>
            <h2 id="widget-settings-title">{state.settings.widget.name}</h2>
            <p>Manage safe widget copy, allowed domains, and the install snippet for this public key.</p>
          </div>
          <div className="page-actions">
            <button className="secondary-button" type="button" onClick={() => onNavigate(`/console/sites/${siteId}`)}>
              Back to site
            </button>
          </div>
        </div>

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
              <input id="widget-settings-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} disabled={submitState === 'submitting'} />
            </label>
            <label className="field" htmlFor="widget-settings-assistant">
              <span>Assistant display name</span>
              <input id="widget-settings-assistant" value={form.assistantDisplayName} onChange={(event) => setForm({ ...form, assistantDisplayName: event.currentTarget.value })} disabled={submitState === 'submitting'} />
            </label>
            <label className="field" htmlFor="widget-settings-launcher">
              <span>Launcher label</span>
              <input id="widget-settings-launcher" value={form.launcherLabel} onChange={(event) => setForm({ ...form, launcherLabel: event.currentTarget.value })} disabled={submitState === 'submitting'} />
            </label>
            <label className="field" htmlFor="widget-settings-color-mode">
              <span>Theme color mode</span>
              <select id="widget-settings-color-mode" value={form.colorMode} onChange={(event) => setForm({ ...form, colorMode: event.currentTarget.value as WidgetSettingsForm['colorMode'] })} disabled={submitState === 'submitting'}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="field settings-grid__wide" htmlFor="widget-settings-title-input">
              <span>Welcome title</span>
              <input id="widget-settings-title-input" value={form.welcomeTitle} onChange={(event) => setForm({ ...form, welcomeTitle: event.currentTarget.value })} disabled={submitState === 'submitting'} />
            </label>
            <label className="field settings-grid__wide" htmlFor="widget-settings-subtitle">
              <span>Welcome subtitle</span>
              <input id="widget-settings-subtitle" value={form.welcomeSubtitle} onChange={(event) => setForm({ ...form, welcomeSubtitle: event.currentTarget.value })} disabled={submitState === 'submitting'} />
            </label>
          </div>
          <LegacyFormStatus state={submitState} error="Settings could not be saved. Check the plain text fields and try again." />
          <div className="button-row">
            <button className="primary-button" type="submit" disabled={submitState === 'submitting' || !canSaveSettings}>Save settings</button>
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
            <button className="secondary-button" type="button" onClick={() => void handleLocalDiagnosticsRefresh()} disabled={diagnosticsRefreshState === 'submitting'}>
              {diagnosticsRefreshState === 'submitting' ? 'Refreshing local diagnostics…' : 'Refresh local diagnostics'}
            </button>
          </div>
          <LegacyFormStatus state={diagnosticsRefreshState} error="Local diagnostics could not be refreshed. Unsaved widget copy and route handle drafts were kept; try again." />
          {nextLocalReplyCandidate ? (
            <div className="list-card list-card--nested" aria-label="Next local manual reply target">
              <div className="list-row list-row--static">
                <span>
                  <strong>next manual reply target ID</strong>
                  <code className="public-key">{nextLocalReplyCandidate.id}</code>
                  <small>Local-only targetIntentId for local-panda:reply-manual.</small>
                </span>
                <button className="secondary-button" type="button" onClick={() => handleCopyNextLocalReplyTarget(nextLocalReplyCandidate.id)}>
                  {targetCopyState === 'copied' ? 'Copied' : 'Copy target ID'}
                </button>
              </div>
              <NextLocalReplyCandidateDetails candidate={nextLocalReplyCandidate} />
              <div className="local-reply-command">
                <strong>Targeted local manual reply command</strong>
                <label className="field" htmlFor="local-manual-reply-text">
                  <span>Local manual reply text</span>
                  <textarea id="local-manual-reply-text" aria-describedby="local-manual-reply-guidance" value={localManualReply.draft} onChange={(event) => dispatchLocalManualReply({ type: 'draftChanged', draft: event.currentTarget.value })} />
                </label>
                {localManualReplyCommand ? (
                  <pre className="snippet-box local-reply-command__code" aria-label="Targeted local manual reply command"><code>{localManualReplyCommand}</code></pre>
                ) : null}
                <p id="local-manual-reply-guidance" className={localManualReplyCommand && localManualReply.copyErrorCommand === localManualReplyCommand ? 'local-reply-command__error' : 'local-reply-command__help'} role="status" aria-live="polite">
                  {!localManualReplyCommand ? 'Enter reply text to generate a command.' : localManualReply.copyErrorCommand === localManualReplyCommand ? 'Copy failed; select the command manually.' : 'Copy this command and run it manually in a local terminal.'}
                </p>
                <div className="button-row">
                  <button className="secondary-button" type="button" disabled={!localManualReplyCommand} onClick={() => localManualReplyCommand && void handleCopyLocalManualReplyCommand(localManualReplyCommand)}>
                    {localManualReply.copiedCommand === localManualReplyCommand && localManualReplyCommand ? 'Copied' : 'Copy reply command'}
                  </button>
                </div>
              </div>
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
              <input id="widget-connection-route-handle" placeholder="panda:workspace/route" value={connectionDraft} onChange={(event) => setConnectionDraft(event.currentTarget.value)} disabled={connectionSubmitState === 'submitting'} />
            </label>
            <button className="primary-button" type="submit" disabled={connectionSubmitState === 'submitting' || !connectionDraft.trim()}>Save placeholder</button>
          </form>
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={() => void handleConnectionClear()} disabled={connectionSubmitState === 'submitting' || (!state.settings.connection.routeHandle && !connectionDraft.trim())}>Clear connection</button>
          </div>
          <LegacyFormStatus state={connectionSubmitState} error="Panda connection placeholder could not be saved. Check the route handle and try again." />
        </section>

        <section className="dashboard-card" aria-labelledby="allowed-domains-title">
          <div>
            <p className="eyebrow">Allowed domains</p>
            <h2 id="allowed-domains-title">Allowed domains</h2>
            <p>Add each hostname where this widget may bootstrap. Ports are ignored for schemeful origins.</p>
          </div>
          {state.domains.length === 0 ? (
            <div className="empty-state">
              <h3>No allowed domains yet</h3>
              <p>Add an allowed domain before installing this widget on a website.</p>
              <button className="secondary-button" type="button" onClick={() => document.getElementById('widget-domain-input')?.focus()}>Focus domain field</button>
            </div>
          ) : (
            <div className="list-card list-card--nested" aria-label="Allowed widget domains">
              {state.domains.map((domain) => (
                <div className="list-row list-row--static" key={domain.id}>
                  <span><strong>{domain.domain}</strong><small>Created {formatDate(domain.createdAt)}</small></span>
                  <button className="secondary-button" type="button" onClick={() => void handleDeleteDomain(domain.id)} disabled={domainSubmitState === 'submitting'}>Delete</button>
                </div>
              ))}
            </div>
          )}
          <form className="inline-form" onSubmit={handleDomainSubmit} aria-busy={domainSubmitState === 'submitting'}>
            <label className="field" htmlFor="widget-domain-input">
              <span>Domain or origin</span>
              <input id="widget-domain-input" placeholder="example.com or https://example.com" value={domainDraft} onChange={(event) => setDomainDraft(event.currentTarget.value)} disabled={domainSubmitState === 'submitting'} />
            </label>
            <button className="primary-button" type="submit" disabled={domainSubmitState === 'submitting' || !domainDraft.trim()}>Add domain</button>
          </form>
          <LegacyFormStatus state={domainSubmitState} error="Domain could not be updated. Check the hostname and try again." />
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
                <button className="secondary-button" type="button" onClick={() => handleCopySnippet(snippet)}>{copyState === 'copied' ? 'Copied' : 'Copy snippet'}</button>
              </div>
            </>
          ) : (
            <LegacyInlineState title="Snippet locked" body="Add an allowed domain to generate the install snippet." />
          )}
        </section>
      </section>
    </WidgetSettingsLegacyWrapper>
  );
}

function WidgetSettingsLegacyWrapper({ children }: { children: React.ReactNode }) {
  return <div className="widget-settings-legacy-compat">{children}</div>;
}

function NextLocalReplyCandidateDetails({ candidate }: { candidate: ConsoleWidgetNextLocalReplyCandidate }) {
  const details = nextLocalReplyCandidateDetails(candidate);
  return (
    <dl className="local-reply-candidate-details" aria-label="Next local reply candidate details">
      {details.map(({ label, value }) => (
        <div className="local-reply-candidate-detail" key={label}><dt>{label}</dt><dd><code className="public-key">{value}</code></dd></div>
      ))}
    </dl>
  );
}

function LegacyFormStatus({ error, state }: { error: string; state: SubmitState }) {
  if (state === 'submitting') return <p className="form-status" role="status">Working…</p>;
  if (state === 'error') return <p className="form-status form-status--error" role="alert">{error}</p>;
  return <p className="form-status" aria-hidden="true">&nbsp;</p>;
}

function LegacyInlineState({ body, title, tone = 'loading' }: { body: string; title: string; tone?: 'loading' | 'error' }) {
  return (
    <section className="dashboard-card" role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'}>
      <p className="eyebrow">{tone === 'error' ? 'Needs attention' : 'Loading'}</p>
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  );
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
