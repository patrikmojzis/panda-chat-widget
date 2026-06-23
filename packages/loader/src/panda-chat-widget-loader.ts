(() => {
  type LoaderConfigInput = {
    publicKey?: string | null | undefined;
    widgetKey?: string | null | undefined;
    siteKey?: string | null | undefined;
  };

  type LoaderConfigResult =
    | {
        status: 'configured';
        publicKey: string;
      }
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
  const PANEL_PLACEHOLDER_CLASS = 'panda-chat-widget-panel-placeholder';
  const PANEL_CLOSE_BUTTON_CLASS = 'panda-chat-widget-panel-close';
  const LAUNCHER_LABEL = 'Chat';
  const PANEL_LABEL = 'Chat widget shell';
  const PANEL_PLACEHOLDER_TEXT = 'Chat widget shell placeholder';
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
  right: 20px;
  bottom: 20px;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLASS} {
  width: 320px;
  min-height: 160px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 16px;
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
  padding: 16px;
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLASS}[hidden] {
  display: none;
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_PLACEHOLDER_CLASS} {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLOSE_BUTTON_CLASS} {
  appearance: none;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 9999px;
  background: #ffffff;
  color: #0f172a;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  padding: 8px 12px;
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
  min-width: 64px;
  padding: 14px 18px;
}
#${LAUNCHER_CONTAINER_ID} .${LAUNCHER_BUTTON_CLASS}:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.35);
  outline-offset: 3px;
}
`;

    hostDocument.head.appendChild(styleElement);
  }

  function mountLauncher(hostDocument: Document | null, config: LoaderConfigResult): void {
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

    const panelPlaceholderElement = hostDocument.createElement('div');
    panelPlaceholderElement.className = PANEL_PLACEHOLDER_CLASS;
    panelPlaceholderElement.textContent = PANEL_PLACEHOLDER_TEXT;

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
      containerElement.setAttribute('data-state', isOpen ? 'open' : 'closed');
      buttonElement.setAttribute('aria-expanded', String(isOpen));
    }

    buttonElement.addEventListener('click', () => {
      setOpen(!isOpen);
    });

    closeButtonElement.addEventListener('click', () => {
      setOpen(false);
    });

    panelElement.appendChild(panelPlaceholderElement);
    panelElement.appendChild(closeButtonElement);
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

  mountLauncher(getHostDocument(), config);
})();
