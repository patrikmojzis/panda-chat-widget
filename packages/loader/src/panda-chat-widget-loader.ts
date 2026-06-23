(() => {
  type PandaChatWidgetLoaderGlobal = {
    version: string;
  };

  type LoaderWindow = Window & {
    PandaChatWidgetLoader?: PandaChatWidgetLoaderGlobal;
  };

  const LOADER_VERSION = '0.0.0';
  const loaderWindow = window as LoaderWindow;

  loaderWindow.PandaChatWidgetLoader = loaderWindow.PandaChatWidgetLoader ?? {
    version: LOADER_VERSION,
  };
})();
