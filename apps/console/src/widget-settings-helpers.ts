import {
  type ConsoleAllowedDomain,
  type ConsoleWidgetNextLocalReplyCandidate,
  type ConsoleWidgetSettings,
  type getWidgetSettings,
} from './console-api';
import {
  createLocalManualReplyState,
  localManualReplyCopyCoordinator,
  type LocalManualReplyScope,
} from './local-manual-reply-command';

export type WidgetSettingsState =
  | { status: 'loading' }
  | { status: 'ready'; settings: ConsoleWidgetSettings; domains: ConsoleAllowedDomain[] }
  | { status: 'notFound' }
  | { status: 'error' };

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
