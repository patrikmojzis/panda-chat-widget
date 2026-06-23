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

  const loaderWindow = window as LoaderWindow;
  const existingLoader = loaderWindow.PandaChatWidgetLoader;

  loaderWindow.PandaChatWidgetLoader = {
    ...existingLoader,
    version: LOADER_VERSION,
    config: readLoaderConfig(loaderWindow, getCurrentScript()),
  };
})();
