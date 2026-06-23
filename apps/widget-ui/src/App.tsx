import { useEffect, useState } from 'react';
import { loadWidgetBootstrap, type WidgetBootstrapLoadState } from './widget-bootstrap';
import type { WidgetPublicKeyState } from './widget-public-key';

type AppProps = {
  widgetPublicKey: WidgetPublicKeyState;
  bootstrapBaseHref: string;
};

function publicKeyFromState(widgetPublicKey: WidgetPublicKeyState): string | null {
  return widgetPublicKey.status === 'configured' ? widgetPublicKey.publicKey : null;
}

function initialBootstrapState(publicKey: string | null): WidgetBootstrapLoadState {
  return publicKey ? { status: 'loading' } : { status: 'missing_key' };
}

export function App({ widgetPublicKey, bootstrapBaseHref }: AppProps) {
  const publicKey = publicKeyFromState(widgetPublicKey);
  const [bootstrapState, setBootstrapState] = useState<WidgetBootstrapLoadState>(() =>
    initialBootstrapState(publicKey),
  );

  useEffect(() => {
    let isCurrent = true;

    if (!publicKey) {
      setBootstrapState({ status: 'missing_key' });
      return () => {
        isCurrent = false;
      };
    }

    setBootstrapState({ status: 'loading' });

    void loadWidgetBootstrap(publicKey, { baseHref: bootstrapBaseHref }).then((nextState) => {
      if (isCurrent) {
        setBootstrapState(nextState);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [bootstrapBaseHref, publicKey]);

  return (
    <main className="widget-shell" aria-label="Panda chat widget" data-state={bootstrapState.status}>
      <p className="widget-shell__eyebrow">Panda Chat Widget</p>
      <h1>Iframe app shell</h1>
      <BootstrapPlaceholder state={bootstrapState} />
    </main>
  );
}

type BootstrapPlaceholderProps = {
  state: WidgetBootstrapLoadState;
};

function BootstrapPlaceholder({ state }: BootstrapPlaceholderProps) {
  if (state.status === 'missing_key') {
    return <p>Missing widget key. Add a non-empty publicKey query parameter to configure this placeholder.</p>;
  }

  if (state.status === 'loading') {
    return <p>Loading widget configuration…</p>;
  }

  if (state.status === 'error') {
    return <p>Widget configuration could not be loaded. The widget is unavailable for this site.</p>;
  }

  return (
    <p>
      Widget configuration loaded for <code>{state.bootstrap.widget.publicKey}</code>.
    </p>
  );
}
