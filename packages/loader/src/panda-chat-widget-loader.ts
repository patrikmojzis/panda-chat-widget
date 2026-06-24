(() => {
  type LoaderConfigInput = {
    publicKey?: string | null | undefined;
    widgetKey?: string | null | undefined;
    siteKey?: string | null | undefined;
  };

  type ConfiguredLoaderConfig = {
    status: 'configured';
    publicKey: string;
  };

  type LoaderConfigResult =
    | ConfiguredLoaderConfig
    | {
        status: 'missing_key';
      };

  type PandaChatWidgetLoaderGlobal = {
    version: string;
    config: LoaderConfigResult;
  };

  type LoaderWindow = Window & {
    PandaChatWidgetConfig?: LoaderConfigInput;
    PandaChatWidgetLoader?: PandaChatWidgetLoaderGlobal;
  };

  type LoaderScript = Pick<HTMLScriptElement, 'getAttribute'>;

  const LOADER_VERSION = '0.0.0';
  const STYLE_ELEMENT_ID = 'panda-chat-widget-loader-styles';
  const LAUNCHER_CONTAINER_ID = 'panda-chat-widget-launcher';
  const LAUNCHER_CONTAINER_CLASS = 'panda-chat-widget-launcher-container';
  const LAUNCHER_BUTTON_CLASS = 'panda-chat-widget-launcher-button';
  const PANEL_ID = 'panda-chat-widget-panel';
  const PANEL_CLASS = 'panda-chat-widget-panel';
  const PANEL_CLOSE_BUTTON_CLASS = 'panda-chat-widget-panel-close';
  const IFRAME_CLASS = 'panda-chat-widget-frame';
  const LAUNCHER_LABEL = 'Chat';
  const LAUNCHER_OPEN_LABEL = 'Hide chat';
  const PANEL_LABEL = 'Chat widget';
  const IFRAME_TITLE = 'Panda chat widget';
  const WIDGET_IFRAME_PATH = '/widget.html';
  const CLOSE_LABEL = 'Close chat';

  function normalizeConfigValue(value: string | null | undefined): string | undefined {
    const trimmedValue = value?.trim();

    return trimmedValue ? trimmedValue : undefined;
  }

  function preferConfiguredValue(
    primary: string | null | undefined,
    fallback: string | null | undefined,
  ): string | undefined {
    return normalizeConfigValue(primary) ?? normalizeConfigValue(fallback);
  }

  function resolveLoaderConfig(config: LoaderConfigInput): LoaderConfigResult {
    const publicKey =
      normalizeConfigValue(config.publicKey) ??
      normalizeConfigValue(config.widgetKey) ??
      normalizeConfigValue(config.siteKey);

    if (!publicKey) {
      return { status: 'missing_key' };
    }

    return { status: 'configured', publicKey };
  }

  function buildWidgetIframeUrl(config: ConfiguredLoaderConfig, baseHref: string): string {
    const iframeUrl = new URL(WIDGET_IFRAME_PATH, baseHref);
    iframeUrl.searchParams.set('publicKey', config.publicKey);

    return iframeUrl.toString();
  }

  function readScriptConfig(script: LoaderScript | null): LoaderConfigInput {
    if (!script) {
      return {};
    }

    return {
      publicKey: script.getAttribute('data-public-key'),
      widgetKey: script.getAttribute('data-widget-key'),
      siteKey: script.getAttribute('data-site-key'),
    };
  }

  function readLoaderConfig(loaderWindow: LoaderWindow, script: LoaderScript | null): LoaderConfigResult {
    const scriptConfig = readScriptConfig(script);
    const initConfig = loaderWindow.PandaChatWidgetConfig ?? {};

    return resolveLoaderConfig({
      publicKey: preferConfiguredValue(scriptConfig.publicKey, initConfig.publicKey),
      widgetKey: preferConfiguredValue(scriptConfig.widgetKey, initConfig.widgetKey),
      siteKey: preferConfiguredValue(scriptConfig.siteKey, initConfig.siteKey),
    });
  }

  function getCurrentScript(): LoaderScript | null {
    if (typeof document === 'undefined') {
      return null;
    }

    const currentScript = document.currentScript;

    if (!currentScript || typeof currentScript.getAttribute !== 'function') {
      return null;
    }

    return currentScript;
  }

  function getHostDocument(): Document | null {
    if (typeof document === 'undefined') {
      return null;
    }

    return document;
  }

  function ensureLauncherStyles(hostDocument: Document): void {
    if (hostDocument.getElementById(STYLE_ELEMENT_ID)) {
      return;
    }

    const styleElement = hostDocument.createElement('style');
    styleElement.id = STYLE_ELEMENT_ID;
    styleElement.textContent = `
#${LAUNCHER_CONTAINER_ID} {
  position: fixed;
  right: max(16px, env(safe-area-inset-right, 0px));
  bottom: max(16px, env(safe-area-inset-bottom, 0px));
  z-index: 2147483647;
  max-width: calc(100vw - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px));
  max-height: calc(100vh - 32px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLASS} {
  box-sizing: border-box;
  width: min(380px, calc(100vw - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)));
  height: min(640px, calc(100vh - 104px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
  min-height: min(360px, calc(100vh - 104px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 18px;
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
  padding: 10px;
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLASS}[hidden] {
  display: none;
}
#${LAUNCHER_CONTAINER_ID} .${IFRAME_CLASS} {
  border: 0;
  border-radius: 12px;
  display: block;
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLOSE_BUTTON_CLASS} {
  align-self: flex-end;
  appearance: none;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 9999px;
  background: #ffffff;
  color: #0f172a;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  line-height: 1;
  padding: 8px 12px;
  user-select: none;
  white-space: nowrap;
}
#${LAUNCHER_CONTAINER_ID} .${LAUNCHER_BUTTON_CLASS} {
  appearance: none;
  border: 0;
  border-radius: 9999px;
  background: #2563eb;
  color: #ffffff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.24);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  min-height: 48px;
  max-width: 100%;
  min-width: 64px;
  padding: 14px 18px;
  user-select: none;
  white-space: nowrap;
}
#${LAUNCHER_CONTAINER_ID}[data-state="open"] .${LAUNCHER_BUTTON_CLASS} {
  background: #0f172a;
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLOSE_BUTTON_CLASS}:focus-visible,
#${LAUNCHER_CONTAINER_ID} .${LAUNCHER_BUTTON_CLASS}:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.35);
  outline-offset: 3px;
}
`;

    hostDocument.head.appendChild(styleElement);
  }

  function mountLauncher(hostDocument: Document | null, config: LoaderConfigResult, baseHref: string): void {
    if (!hostDocument || !hostDocument.head || !hostDocument.body || config.status !== 'configured') {
      return;
    }

    if (hostDocument.getElementById(LAUNCHER_CONTAINER_ID)) {
      return;
    }

    ensureLauncherStyles(hostDocument);

    const containerElement = hostDocument.createElement('div');
    containerElement.id = LAUNCHER_CONTAINER_ID;
    containerElement.className = LAUNCHER_CONTAINER_CLASS;

    const panelElement = hostDocument.createElement('div');
    panelElement.id = PANEL_ID;
    panelElement.className = PANEL_CLASS;
    panelElement.hidden = true;
    panelElement.setAttribute('role', 'dialog');
    panelElement.setAttribute('aria-label', PANEL_LABEL);

    const iframeElement = hostDocument.createElement('iframe');
    iframeElement.className = IFRAME_CLASS;
    iframeElement.setAttribute('src', buildWidgetIframeUrl(config, baseHref));
    iframeElement.setAttribute('title', IFRAME_TITLE);

    const closeButtonElement = hostDocument.createElement('button');
    closeButtonElement.className = PANEL_CLOSE_BUTTON_CLASS;
    closeButtonElement.textContent = 'Close';
    closeButtonElement.setAttribute('type', 'button');
    closeButtonElement.setAttribute('aria-label', CLOSE_LABEL);

    const buttonElement = hostDocument.createElement('button');
    buttonElement.className = LAUNCHER_BUTTON_CLASS;
    buttonElement.textContent = LAUNCHER_LABEL;
    buttonElement.setAttribute('type', 'button');
    buttonElement.setAttribute('aria-label', LAUNCHER_LABEL);
    buttonElement.setAttribute('aria-controls', PANEL_ID);

    let isOpen = false;

    function setOpen(nextIsOpen: boolean): void {
      isOpen = nextIsOpen;
      panelElement.hidden = !isOpen;
      panelElement.setAttribute('aria-hidden', String(!isOpen));
      containerElement.setAttribute('data-state', isOpen ? 'open' : 'closed');
      buttonElement.textContent = isOpen ? LAUNCHER_OPEN_LABEL : LAUNCHER_LABEL;
      buttonElement.setAttribute('aria-expanded', String(isOpen));
      buttonElement.setAttribute('aria-label', isOpen ? LAUNCHER_OPEN_LABEL : LAUNCHER_LABEL);
    }

    buttonElement.addEventListener('click', () => {
      setOpen(!isOpen);
    });

    closeButtonElement.addEventListener('click', () => {
      setOpen(false);
    });

    panelElement.appendChild(closeButtonElement);
    panelElement.appendChild(iframeElement);
    containerElement.appendChild(panelElement);
    containerElement.appendChild(buttonElement);
    setOpen(false);
    hostDocument.body.appendChild(containerElement);
  }

  const loaderWindow = window as LoaderWindow;
  const existingLoader = loaderWindow.PandaChatWidgetLoader;
  const config = readLoaderConfig(loaderWindow, getCurrentScript());

  loaderWindow.PandaChatWidgetLoader = {
    ...existingLoader,
    version: LOADER_VERSION,
    config,
  };

  mountLauncher(getHostDocument(), config, loaderWindow.location.href);
})();
