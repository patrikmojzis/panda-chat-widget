/**
 * Classic IIFE entry for panda-chat-widget-loader.js.
 * Preserves legacy auto-init, globals, config/key aliases, and duplicate-load behavior.
 * Uses the same lifecycle core as the ESM entry.
 */

import type { PandaChatWidget, PandaChatWidgetOptions } from './types.js';
import type { WidgetController } from './core.js';
import { createWidgetController } from './core.js';
import { createIframeDriver } from './iframe-driver.js';

const LOADER_VERSION = '0.0.0';
const GLOBAL_KEY = Symbol.for('__panda_chat_widget_default__');

type LoaderConfigInput = {
  publicKey?: string | null | undefined;
  widgetKey?: string | null | undefined;
  siteKey?: string | null | undefined;
  baseUrl?: string | null | undefined;
  launcher?: string | boolean | null | undefined;
};

type LoaderConfigResult =
  | { status: 'configured'; publicKey: string }
  | { status: 'missing_key' };

type PandaChatWidgetLoaderGlobal = {
  readonly version: string;
  readonly config: LoaderConfigResult;
};

interface ClassicGlobal {
  PandaChatWidgetConfig?: LoaderConfigInput;
  PandaChatWidgetLoader?: PandaChatWidgetLoaderGlobal;
  PandaChatWidget?: PandaChatWidget & { create(): PandaChatWidget };
}

type ClassicWindow = Window & ClassicGlobal;

interface DefaultInstanceRegistry {
  controller: WidgetController;
  instance: PandaChatWidget & { create(): PandaChatWidget };
  initOptions: PandaChatWidgetOptions | null;
}

function normalizeConfigValue(value: string | null | undefined): string | undefined {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue : undefined;
}

function readScriptConfig(script: Pick<HTMLScriptElement, 'getAttribute'> | null): LoaderConfigInput {
  if (!script) {
    return {};
  }

  return {
    publicKey: script.getAttribute('data-public-key'),
    widgetKey: script.getAttribute('data-widget-key'),
    siteKey: script.getAttribute('data-site-key'),
    baseUrl: script.getAttribute('data-base-url'),
    launcher: script.getAttribute('data-launcher'),
  };
}

function resolveKey(scriptConfig: LoaderConfigInput, globalConfig: LoaderConfigInput): string | undefined {
  const scriptPublic = normalizeConfigValue(scriptConfig.publicKey);
  const scriptWidget = normalizeConfigValue(scriptConfig.widgetKey);
  const scriptSite = normalizeConfigValue(scriptConfig.siteKey);

  if (scriptPublic || scriptWidget || scriptSite) {
    return scriptPublic ?? scriptWidget ?? scriptSite;
  }

  const globalPublic = normalizeConfigValue(globalConfig.publicKey);
  const globalWidget = normalizeConfigValue(globalConfig.widgetKey);
  const globalSite = normalizeConfigValue(globalConfig.siteKey);

  return globalPublic ?? globalWidget ?? globalSite;
}

function resolveBaseUrl(scriptConfig: LoaderConfigInput, globalConfig: LoaderConfigInput): string | undefined {
  const scriptVal = normalizeConfigValue(typeof scriptConfig.baseUrl === 'string' ? scriptConfig.baseUrl : undefined);

  if (scriptVal !== undefined) {
    return scriptVal;
  }

  return normalizeConfigValue(typeof globalConfig.baseUrl === 'string' ? globalConfig.baseUrl : undefined);
}

type LauncherResult = { valid: true; value: boolean | undefined } | { valid: false };

function resolveLauncher(scriptConfig: LoaderConfigInput, globalConfig: LoaderConfigInput): LauncherResult {
  // Script data-launcher wins field-by-field
  if (scriptConfig.launcher !== null && scriptConfig.launcher !== undefined) {
    if (scriptConfig.launcher === 'true' || scriptConfig.launcher === true) return { valid: true, value: true };
    if (scriptConfig.launcher === 'false' || scriptConfig.launcher === false) return { valid: true, value: false };

    // Present but not 'true' or 'false' => invalid
    return { valid: false };
  }

  if (globalConfig.launcher !== null && globalConfig.launcher !== undefined) {
    if (globalConfig.launcher === true || globalConfig.launcher === 'true') return { valid: true, value: true };
    if (globalConfig.launcher === false || globalConfig.launcher === 'false') return { valid: true, value: false };

    return { valid: false };
  }

  return { valid: true, value: undefined };
}

function getCurrentScript(): Pick<HTMLScriptElement, 'getAttribute'> | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const currentScript = document.currentScript;

  if (!currentScript || typeof currentScript.getAttribute !== 'function') {
    return null;
  }

  return currentScript;
}

function getDefaultInstance(win: ClassicWindow): DefaultInstanceRegistry {
  const g = globalThis as Record<symbol, DefaultInstanceRegistry | undefined>;
  let registry = g[GLOBAL_KEY];

  if (registry) {
    return registry;
  }

  const controller = createWidgetController(
    () => createIframeDriver(),
    () => typeof document !== 'undefined' ? document : null,
  );
  const instanceWithCreate = controller.widget as PandaChatWidget & { create(): PandaChatWidget };

  instanceWithCreate.create = function create(): PandaChatWidget {
    return createWidgetController(
      () => createIframeDriver(),
      () => typeof document !== 'undefined' ? document : null,
    ).widget;
  };

  registry = {
    controller,
    instance: instanceWithCreate,
    initOptions: null,
  };
  g[GLOBAL_KEY] = registry;

  return registry;
}

(function classicInit(): void {
  const win = window as ClassicWindow;
  const script = getCurrentScript();
  const scriptConfig = readScriptConfig(script);
  const globalConfig: LoaderConfigInput = win.PandaChatWidgetConfig ?? {};

  const publicKey = resolveKey(scriptConfig, globalConfig);
  const baseUrl = resolveBaseUrl(scriptConfig, globalConfig);
  const launcherResult = resolveLauncher(scriptConfig, globalConfig);

  const loaderConfig: LoaderConfigResult = publicKey
    ? { status: 'configured', publicKey }
    : { status: 'missing_key' };

  // Freeze metadata so consumers can't mutate it
  const frozenLoaderConfig = Object.freeze(loaderConfig);
  const existingLoader = win.PandaChatWidgetLoader;

  // Only set metadata on the first load; preserve first owner's metadata
  if (!existingLoader) {
    win.PandaChatWidgetLoader = Object.freeze({
      version: LOADER_VERSION,
      config: frozenLoaderConfig,
    });
  }

  const registry = getDefaultInstance(win);
  win.PandaChatWidget = registry.instance;

  const options: PandaChatWidgetOptions = launcherResult.valid
    ? {
        publicKey: publicKey ?? '',
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(launcherResult.value !== undefined ? { launcher: launcherResult.value } : {}),
      }
    : { publicKey: publicKey ?? '', launcher: 'invalid' as unknown as boolean };

  if (registry.initOptions !== null) {
    const lifecycle = registry.instance.getState().lifecycle;
    if (lifecycle === 'initializing' || lifecycle === 'ready') {
      registry.controller.recordClassicDuplicate(options);
      return;
    }
  }

  registry.initOptions = options;
  registry.instance.init(options).catch(() => {});
})();
