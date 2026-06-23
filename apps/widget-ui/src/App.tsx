import type { WidgetPublicKeyState } from './widget-public-key';

type AppProps = {
  widgetPublicKey: WidgetPublicKeyState;
};

export function App({ widgetPublicKey }: AppProps) {
  const isConfigured = widgetPublicKey.status === 'configured';

  return (
    <main className="widget-shell" aria-label="Panda chat widget" data-state={widgetPublicKey.status}>
      <p className="widget-shell__eyebrow">Panda Chat Widget</p>
      <h1>Iframe app shell</h1>
      {isConfigured ? (
        <p>
          Loaded placeholder for widget key <code>{widgetPublicKey.publicKey}</code>.
        </p>
      ) : (
        <p>Missing widget key. Add a non-empty publicKey query parameter to configure this placeholder.</p>
      )}
    </main>
  );
}
