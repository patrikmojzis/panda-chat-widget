/**
 * Temporary iframe-load readiness adapter for S1.
 * Reports ready on iframe 'load' event, error on 'error' or 10s timeout.
 * S2 replaces this with exact-origin handshake + shell-ready.
 */

import type { WidgetDriver, WidgetDriverCallbacks } from './driver.js';

const STYLE_ELEMENT_ID = 'panda-chat-widget-loader-styles';
const LAUNCHER_CONTAINER_ID = 'panda-chat-widget-launcher';
const LAUNCHER_CONTAINER_CLASS = 'panda-chat-widget-launcher-container';
const LAUNCHER_BUTTON_CLASS = 'panda-chat-widget-launcher-button';
const PANEL_ID = 'panda-chat-widget-panel';
const PANEL_CLASS = 'panda-chat-widget-panel';
const PANEL_CLOSE_BUTTON_CLASS = 'panda-chat-widget-panel-close';
const IFRAME_CLASS = 'panda-chat-widget-frame';
const LAUNCHER_LABEL = 'Open chat';
const LAUNCHER_OPEN_LABEL = 'Hide chat';
const PANEL_LABEL = 'Chat widget';
const IFRAME_TITLE = 'Panda chat widget';
const WIDGET_IFRAME_PATH = 'widget.html';
const CLOSE_LABEL = 'Close chat';
const LOAD_TIMEOUT_MS = 10_000;

function buildWidgetIframeUrl(publicKey: string, baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const iframeUrl = new URL(WIDGET_IFRAME_PATH, base);
  iframeUrl.searchParams.set('publicKey', publicKey);

  return iframeUrl.toString();
}

const STYLE_CSS = `
#${LAUNCHER_CONTAINER_ID} {
  position: fixed;
  right: max(12px, env(safe-area-inset-right, 0px));
  bottom: max(12px, env(safe-area-inset-bottom, 0px));
  z-index: 2147483647;
  max-width: calc(100vw - 24px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px));
  max-height: calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLASS} {
  box-sizing: border-box;
  position: relative;
  width: min(400px, calc(100vw - 24px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)));
  height: min(680px, calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
  min-height: min(360px, calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
  border: 1px solid rgba(17, 24, 39, 0.12);
  border-radius: 24px;
  background: #ffffff;
  color: #111827;
  box-shadow: 0 24px 64px rgba(17, 24, 39, 0.2), 0 4px 16px rgba(17, 24, 39, 0.08);
  overflow: hidden;
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLASS}[hidden] {
  display: none;
}
#${LAUNCHER_CONTAINER_ID} .${IFRAME_CLASS} {
  border: 0;
  border-radius: inherit;
  display: block;
  height: 100%;
  width: 100%;
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLOSE_BUTTON_CLASS} {
  appearance: none;
  box-sizing: border-box;
  position: absolute;
  top: 16px;
  right: 14px;
  z-index: 2;
  width: 32px;
  height: 32px;
  overflow: hidden;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  font-size: 0;
  padding: 0;
  user-select: none;
  transition: color 140ms ease, background 140ms ease;
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLOSE_BUTTON_CLASS}::before,
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLOSE_BUTTON_CLASS}::after {
  position: absolute;
  top: 15px;
  left: 9px;
  width: 14px;
  height: 2px;
  border-radius: 999px;
  background: currentColor;
  content: "";
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLOSE_BUTTON_CLASS}::before {
  transform: rotate(45deg);
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLOSE_BUTTON_CLASS}::after {
  transform: rotate(-45deg);
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLOSE_BUTTON_CLASS}:hover {
  color: #111827;
  background: #f3f4f6;
}
#${LAUNCHER_CONTAINER_ID} .${LAUNCHER_BUTTON_CLASS} {
  appearance: none;
  box-sizing: border-box;
  position: relative;
  width: 52px;
  height: 52px;
  overflow: hidden;
  border: 0;
  border-radius: 999px;
  background: #111827;
  color: #ffffff;
  box-shadow: 0 10px 28px rgba(17, 24, 39, 0.24);
  cursor: pointer;
  font-size: 0;
  padding: 0;
  user-select: none;
  transition: transform 140ms ease, box-shadow 140ms ease;
}
#${LAUNCHER_CONTAINER_ID} .${LAUNCHER_BUTTON_CLASS}::before {
  box-sizing: border-box;
  position: absolute;
  top: 15px;
  left: 14px;
  width: 24px;
  height: 20px;
  border: 2px solid currentColor;
  border-radius: 8px;
  content: "";
}
#${LAUNCHER_CONTAINER_ID} .${LAUNCHER_BUTTON_CLASS}::after {
  position: absolute;
  top: 31px;
  left: 19px;
  width: 7px;
  height: 7px;
  border-bottom: 2px solid currentColor;
  border-left: 2px solid currentColor;
  background: #111827;
  content: "";
  transform: skewY(-35deg);
}
#${LAUNCHER_CONTAINER_ID} .${LAUNCHER_BUTTON_CLASS}:hover {
  box-shadow: 0 14px 34px rgba(17, 24, 39, 0.3);
  transform: translateY(-1px);
}
#${LAUNCHER_CONTAINER_ID} .${LAUNCHER_BUTTON_CLASS}:active {
  transform: scale(0.96);
}
#${LAUNCHER_CONTAINER_ID}[data-state="open"] .${LAUNCHER_BUTTON_CLASS} {
  display: none;
}
#${LAUNCHER_CONTAINER_ID} .${PANEL_CLOSE_BUTTON_CLASS}:focus-visible,
#${LAUNCHER_CONTAINER_ID} .${LAUNCHER_BUTTON_CLASS}:focus-visible {
  outline: 3px solid rgba(17, 24, 39, 0.24);
  outline-offset: 3px;
}
@media (max-width: 480px) {
  #${LAUNCHER_CONTAINER_ID} .${PANEL_CLASS} {
    border-radius: 20px;
  }
}
`;

export interface IframeDriverClock {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

const DEFAULT_CLOCK: IframeDriverClock = {
  setTimeout(callback, delay) {
    return globalThis.setTimeout(callback, delay);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export function createIframeDriver(clock: IframeDriverClock = DEFAULT_CLOCK): WidgetDriver {
  // Track only SDK-created nodes so destroy removes only what we created
  let ownedStyleElement: HTMLElement | null = null;
  let ownedContainerElement: HTMLElement | null = null;
  let panelElement: HTMLElement | null = null;
  let iframeElement: HTMLIFrameElement | null = null;
  let launcherButton: HTMLElement | null = null;
  let closeButton: HTMLElement | null = null;
  let timeoutId: unknown | null = null;
  let hostDoc: Document | null = null;
  let settled = false;
  let isOpen = false;
  let launcherClickHandler: (() => void) | null = null;
  let closeClickHandler: (() => void) | null = null;
  let iframeLoadHandler: (() => void) | null = null;
  let iframeErrorHandler: (() => void) | null = null;

  function applyVisibility(open: boolean): void {
    isOpen = open;

    if (panelElement) {
      panelElement.hidden = !open;
      panelElement.setAttribute('aria-hidden', String(!open));
    }

    if (ownedContainerElement) {
      ownedContainerElement.setAttribute('data-state', open ? 'open' : 'closed');
    }

    if (launcherButton) {
      launcherButton.textContent = open ? LAUNCHER_OPEN_LABEL : LAUNCHER_LABEL;
      launcherButton.setAttribute('aria-expanded', String(open));
      launcherButton.setAttribute('aria-label', open ? LAUNCHER_OPEN_LABEL : LAUNCHER_LABEL);
    }
  }

  function cleanup(): void {
    if (timeoutId !== null) {
      clock.clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (iframeElement && iframeLoadHandler) {
      iframeElement.removeEventListener('load', iframeLoadHandler);
    }

    if (iframeElement && iframeErrorHandler) {
      iframeElement.removeEventListener('error', iframeErrorHandler);
    }

    if (launcherButton && launcherClickHandler) {
      launcherButton.removeEventListener('click', launcherClickHandler);
    }

    if (closeButton && closeClickHandler) {
      closeButton.removeEventListener('click', closeClickHandler);
    }

    iframeLoadHandler = null;
    iframeErrorHandler = null;
    launcherClickHandler = null;
    closeClickHandler = null;
  }

  function removeOwnedDOM(): void {
    // Remove only SDK-created nodes, never host-owned elements
    if (ownedContainerElement && ownedContainerElement.parentNode) {
      ownedContainerElement.parentNode.removeChild(ownedContainerElement);
    }

    if (ownedStyleElement && ownedStyleElement.parentNode) {
      ownedStyleElement.parentNode.removeChild(ownedStyleElement);
    }

    ownedContainerElement = null;
    ownedStyleElement = null;
    panelElement = null;
    iframeElement = null;
    launcherButton = null;
    closeButton = null;
  }

  return {
    mount(doc: Document, publicKey: string, baseUrl: string, showLauncher: boolean, callbacks: WidgetDriverCallbacks): void {
      hostDoc = doc;
      settled = false;

      // Foreign ID collision: fail closed rather than hanging
      if (!doc.head || !doc.body) {
        throw new Error('Document missing head or body');
      }

      if (doc.getElementById(LAUNCHER_CONTAINER_ID)) {
        throw new Error('Launcher container ID already exists in document');
      }

      // Create and track our own style element (don't reuse foreign ones)
      if (!doc.getElementById(STYLE_ELEMENT_ID)) {
        ownedStyleElement = doc.createElement('style');
        ownedStyleElement.id = STYLE_ELEMENT_ID;
        ownedStyleElement.textContent = STYLE_CSS;
        doc.head.appendChild(ownedStyleElement);
      }

      ownedContainerElement = doc.createElement('div');
      ownedContainerElement.id = LAUNCHER_CONTAINER_ID;
      ownedContainerElement.className = LAUNCHER_CONTAINER_CLASS;

      panelElement = doc.createElement('div');
      panelElement.id = PANEL_ID;
      panelElement.className = PANEL_CLASS;
      panelElement.hidden = true;
      panelElement.setAttribute('role', 'dialog');
      panelElement.setAttribute('aria-label', PANEL_LABEL);

      iframeElement = doc.createElement('iframe') as HTMLIFrameElement;
      iframeElement.className = IFRAME_CLASS;
      iframeElement.setAttribute('src', buildWidgetIframeUrl(publicKey, baseUrl));
      iframeElement.setAttribute('title', IFRAME_TITLE);

      closeButton = doc.createElement('button');
      closeButton.className = PANEL_CLOSE_BUTTON_CLASS;
      closeButton.textContent = 'Close';
      closeButton.setAttribute('type', 'button');
      closeButton.setAttribute('aria-label', CLOSE_LABEL);

      panelElement.appendChild(closeButton);
      panelElement.appendChild(iframeElement);
      ownedContainerElement.appendChild(panelElement);

      if (showLauncher) {
        launcherButton = doc.createElement('button');
        launcherButton.className = LAUNCHER_BUTTON_CLASS;
        launcherButton.textContent = LAUNCHER_LABEL;
        launcherButton.setAttribute('type', 'button');
        launcherButton.setAttribute('aria-label', LAUNCHER_LABEL);
        launcherButton.setAttribute('aria-controls', PANEL_ID);
        ownedContainerElement.appendChild(launcherButton);

        launcherClickHandler = () => {
          callbacks.onVisibilityIntent(!isOpen);
        };

        launcherButton.addEventListener('click', launcherClickHandler);
      }

      closeClickHandler = () => {
        callbacks.onVisibilityIntent(false);
      };

      closeButton.addEventListener('click', closeClickHandler);

      applyVisibility(false);

      iframeLoadHandler = () => {
        if (settled) return;

        settled = true;

        if (timeoutId !== null) {
          clock.clearTimeout(timeoutId);
          timeoutId = null;
        }

        callbacks.onReady();
      };

      iframeErrorHandler = () => {
        if (settled) return;

        settled = true;

        if (timeoutId !== null) {
          clock.clearTimeout(timeoutId);
          timeoutId = null;
        }

        cleanup();
        removeOwnedDOM();
        callbacks.onError();
      };

      iframeElement.addEventListener('load', iframeLoadHandler);
      iframeElement.addEventListener('error', iframeErrorHandler);

      timeoutId = clock.setTimeout(() => {
        if (settled) return;

        settled = true;
        timeoutId = null;
        cleanup();
        removeOwnedDOM();
        callbacks.onError();
      }, LOAD_TIMEOUT_MS);

      doc.body.appendChild(ownedContainerElement);
    },

    setVisibility(open: boolean): void {
      applyVisibility(open);
    },

    destroy(): void {
      cleanup();
      removeOwnedDOM();
      hostDoc = null;
    },
  };
}
