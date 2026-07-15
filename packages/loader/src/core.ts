import type { WidgetDriver, WidgetDriverFactory } from './driver.js';
import type { NormalizedOptions } from './normalize.js';
import type { PandaChatWidget, PandaChatWidgetOptions, PandaChatWidgetSafeError, PandaChatWidgetState } from './types.js';
import { createSafeError, PandaChatWidgetError } from './errors.js';
import { acquireLease, releaseLease } from './lease.js';
import { normalizeOptions, optionsEqual } from './normalize.js';

type GenerationOutcome = 'pending' | 'ready' | 'ended';

type Subscription = {
  readonly listener: (state: PandaChatWidgetState) => void;
  active: boolean;
};

type Generation = {
  readonly id: number;
  readonly doc: Document;
  readonly normalized: NormalizedOptions;
  readonly promise: Promise<PandaChatWidgetState>;
  readonly resolve: (state: PandaChatWidgetState) => void;
  readonly reject: (error: PandaChatWidgetError) => void;
  driver: WidgetDriver | null;
  desiredOpen: boolean;
  outcome: GenerationOutcome;
  classicDiagnostic?: PandaChatWidgetSafeError;
};

export interface WidgetController {
  readonly widget: PandaChatWidget;
  recordClassicDuplicate(options: unknown): void;
}

function createState(
  lifecycle: PandaChatWidgetState['lifecycle'],
  visibility: PandaChatWidgetState['visibility'],
  error?: PandaChatWidgetSafeError,
): PandaChatWidgetState {
  const snapshot = { lifecycle, visibility, auth: 'anonymous' as const };
  return Object.freeze(error ? { ...snapshot, error } : snapshot);
}

function documentOrigin(doc: Document | null): string {
  return doc?.location?.origin ?? 'http://localhost';
}

export function createWidgetController(driverFactory: WidgetDriverFactory, getDoc: () => Document | null): WidgetController {
  let state: PandaChatWidgetState = createState('idle', 'closed');
  let nextGeneration = 0;
  let current: Generation | null = null;
  const subscriptions = new Set<Subscription>();
  const publicationQueue: Array<{
    readonly snapshot: PandaChatWidgetState;
    readonly subscriptions: Subscription[];
  }> = [];
  let isNotifying = false;

  function commit(newState: PandaChatWidgetState): void {
    state = newState;
  }

  function notify(snapshot: PandaChatWidgetState): void {
    publicationQueue.push({ snapshot, subscriptions: [...subscriptions] });
    if (isNotifying) return;

    isNotifying = true;
    try {
      while (publicationQueue.length > 0) {
        const publication = publicationQueue.shift()!;
        for (const subscription of publication.subscriptions) {
          if (!subscription.active || !subscriptions.has(subscription)) continue;
          try {
            subscription.listener(publication.snapshot);
          } catch {
            // Isolate throwing listeners.
          }
        }
      }
    } finally {
      isNotifying = false;
    }
  }

  function publish(newState: PandaChatWidgetState): void {
    commit(newState);
    notify(newState);
  }

  function teardown(record: Generation): void {
    const ownedDriver = record.driver;
    record.driver = null;
    ownedDriver?.destroy();
    releaseLease(record.doc, widget, record.id);
  }

  function terminalError(record: Generation): void {
    if (current !== record || record.outcome !== 'pending') return;

    record.outcome = 'ended';
    current = null;
    teardown(record);

    const safeError = createSafeError('init', 'IFRAME_LOAD_FAILED', true);
    const snapshot = createState('error', 'closed', safeError);
    commit(snapshot);
    record.reject(new PandaChatWidgetError(safeError));
    notify(snapshot);
  }

  function terminalReady(record: Generation): void {
    if (current !== record || record.outcome !== 'pending') return;

    const open = record.desiredOpen;
    record.driver?.setVisibility(open);
    const snapshot = createState('ready', open ? 'open' : 'closed', record.classicDiagnostic);
    commit(snapshot);
    record.outcome = 'ready';
    record.resolve(snapshot);
    notify(snapshot);
  }

  function rejectWithoutGeneration(
    code: Parameters<typeof createSafeError>[1],
    recoverable: boolean,
  ): Promise<PandaChatWidgetState> {
    const safeError = createSafeError('init', code, recoverable);
    const snapshot = createState('error', 'closed', safeError);
    const rejection = Promise.reject<PandaChatWidgetState>(new PandaChatWidgetError(safeError));
    commit(snapshot);
    notify(snapshot);
    return rejection;
  }

  function setDesiredVisibility(open: boolean): void {
    const record = current;

    if (state.lifecycle === 'destroyed') {
      throw new PandaChatWidgetError(createSafeError('init', 'DESTROYED', false));
    }

    if (!record || (state.lifecycle !== 'initializing' && state.lifecycle !== 'ready')) {
      throw new PandaChatWidgetError(createSafeError('init', 'NOT_INITIALIZED', false));
    }

    if (record.desiredOpen === open) return;

    record.desiredOpen = open;
    if (record.outcome === 'ready') record.driver?.setVisibility(open);
    publish(createState(state.lifecycle, open ? 'open' : 'closed', record.classicDiagnostic));
  }

  const widget: PandaChatWidget = {
    init(options: PandaChatWidgetOptions): Promise<PandaChatWidgetState> {
      const active = current && (state.lifecycle === 'initializing' || state.lifecycle === 'ready') ? current : null;
      const doc = active?.doc ?? getDoc();
      const result = normalizeOptions(options, documentOrigin(doc));

      if (active) {
        if (result.normalized && optionsEqual(result.normalized, active.normalized)) {
          return active.promise;
        }

        const code = state.lifecycle === 'initializing' ? 'INIT_OPTIONS_CONFLICT' : 'ALREADY_INITIALIZED';
        return Promise.reject(new PandaChatWidgetError(createSafeError('init', code, false)));
      }

      if (!result.normalized) return rejectWithoutGeneration(result.error, true);
      if (!doc) return rejectWithoutGeneration('INVALID_OPTIONS', true);

      const id = nextGeneration + 1;
      if (!acquireLease(doc, widget, id)) return rejectWithoutGeneration('INSTANCE_CONFLICT', false);
      nextGeneration = id;

      let resolve!: (snapshot: PandaChatWidgetState) => void;
      let reject!: (error: PandaChatWidgetError) => void;
      const promise = new Promise<PandaChatWidgetState>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      const record: Generation = {
        id,
        doc,
        normalized: result.normalized,
        promise,
        resolve,
        reject,
        driver: null,
        desiredOpen: false,
        outcome: 'pending',
      };
      current = record;
      publish(createState('initializing', 'closed'));

      if (current !== record || record.outcome !== 'pending') return promise;

      try {
        record.driver = driverFactory();
        record.driver.mount(doc, record.normalized.publicKey, record.normalized.baseUrl, record.normalized.launcher, {
          onReady(): void {
            terminalReady(record);
          },
          onError(): void {
            terminalError(record);
          },
          onVisibilityIntent(open: boolean): void {
            if (current !== record || record.outcome === 'ended') return;
            try {
              setDesiredVisibility(open);
            } catch {
              // Ignore intents from an inactive generation.
            }
          },
        });
      } catch {
        terminalError(record);
      }

      return promise;
    },

    open(): void {
      setDesiredVisibility(true);
    },

    close(): void {
      setDesiredVisibility(false);
    },

    toggle(): void {
      setDesiredVisibility(!(current?.desiredOpen ?? false));
    },

    destroy(): void {
      if (state.lifecycle === 'destroyed') return;

      const record = current;
      const wasPending = record?.outcome === 'pending';
      if (record) {
        current = null;
        record.outcome = 'ended';
        teardown(record);
      }

      const snapshot = createState('destroyed', 'closed');
      commit(snapshot);
      if (record && wasPending) {
        record.reject(new PandaChatWidgetError(createSafeError('init', 'DESTROYED', false)));
      }
      notify(snapshot);
    },

    getState(): PandaChatWidgetState {
      return state;
    },

    subscribe(listener: (state: PandaChatWidgetState) => void): () => void {
      const subscription: Subscription = { listener, active: true };
      subscriptions.add(subscription);
      try {
        listener(state);
      } catch {
        // Isolate throwing listeners.
      }

      return () => {
        if (!subscription.active) return;
        subscription.active = false;
        subscriptions.delete(subscription);
      };
    },
  };

  return {
    widget,
    recordClassicDuplicate(options: unknown): void {
      const record = current;
      if (!record || (record.outcome !== 'pending' && record.outcome !== 'ready')) return;

      const result = normalizeOptions(options as PandaChatWidgetOptions, documentOrigin(record.doc));
      if (result.normalized && optionsEqual(result.normalized, record.normalized)) return;
      if (record.classicDiagnostic?.code === 'INIT_OPTIONS_CONFLICT') return;

      record.classicDiagnostic = createSafeError('init', 'INIT_OPTIONS_CONFLICT', false);
      publish(createState(state.lifecycle, state.visibility, record.classicDiagnostic));
    },
  };
}

export function createWidgetInstance(driverFactory: WidgetDriverFactory, getDoc: () => Document | null): PandaChatWidget {
  return createWidgetController(driverFactory, getDoc).widget;
}
