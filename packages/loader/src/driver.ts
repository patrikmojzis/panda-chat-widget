/**
 * Driver interface for the widget lifecycle core.
 * S1 injects an iframe-load adapter; S2 replaces with handshake + shell-ready.
 */

export interface WidgetDriverCallbacks {
  onReady(): void;
  onError(): void;
  onVisibilityIntent(open: boolean): void;
}

export interface WidgetDriver {
  mount(doc: Document, publicKey: string, baseUrl: string, showLauncher: boolean, callbacks: WidgetDriverCallbacks): void;
  setVisibility(open: boolean): void;
  destroy(): void;
}

export type WidgetDriverFactory = () => WidgetDriver;
