export class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.id = '';
    this.className = '';
    this.hidden = false;
    this.textContent = '';
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this._listeners = {};
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
    if (name === 'class') this.className = String(value);
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  addEventListener(type, handler) {
    (this._listeners[type] ??= []).push(handler);
  }

  removeEventListener(type, handler) {
    const listeners = this._listeners[type];
    if (!listeners) return;
    const index = listeners.indexOf(handler);
    if (index >= 0) listeners.splice(index, 1);
  }

  fire(type) {
    for (const handler of [...(this._listeners[type] ?? [])]) handler();
  }

  click() { this.fire('click'); }
  fireLoad() { this.fire('load'); }
  fireError() { this.fire('error'); }

  getElementById(id) {
    if (this.id === id) return this;
    for (const child of this.children) {
      const found = child.getElementById(id);
      if (found) return found;
    }
    return null;
  }

  countListeners() {
    return Object.values(this._listeners).reduce((count, listeners) => count + listeners.length, 0)
      + this.children.reduce((count, child) => count + child.countListeners(), 0);
  }
}

export function createFakeDocument(origin = 'https://host.example', attributes = {}) {
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  const document = {
    body,
    head,
    location: { origin },
    currentScript: createScript(attributes),
    createElement(tagName) { return new FakeElement(tagName); },
    getElementById(id) { return head.getElementById(id) ?? body.getElementById(id); },
  };
  return document;
}

export function createScript(attributes = {}) {
  return {
    getAttribute(name) {
      return Object.hasOwn(attributes, name) ? attributes[name] : null;
    },
  };
}

export function findIframe(document) {
  const panel = document.getElementById('panda-chat-widget-panel');
  return panel?.children.find((child) => child.tagName === 'iframe') ?? null;
}
