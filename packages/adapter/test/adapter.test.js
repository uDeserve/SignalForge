import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureError,
  createSignalForgeAdapter,
  createSignalForgeContext,
  linkSentry,
  mountFeedbackWidget,
} from '../src/index.js';

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.type = '';
    this.className = '';
    this.textContent = '';
    this.placeholder = '';
    this.parentNode = null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [];
    for (const child of children) {
      this.appendChild(child);
    }
  }

  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentNode = null;
  }

  addEventListener(type, listener) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type, listener) {
    const current = this.listeners.get(type) ?? [];
    this.listeners.set(type, current.filter((item) => item !== listener));
  }

  async dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener({ preventDefault() {}, ...event });
    }
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type, listener) {
    const current = this.listeners.get(type) ?? [];
    this.listeners.set(type, current.filter((item) => item !== listener));
  }

  async dispatch(type, event) {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener(event);
    }
  }
}

test('adapter creates stable context', () => {
  const context = createSignalForgeContext({
    appName: 'readerapp',
    environment: 'production',
    release: '1.2.3',
    route: '/reader/1',
  });
  assert.equal(context.appName, 'readerapp');
  assert.equal(context.environment, 'production');
  assert.equal(context.release, '1.2.3');
});

test('adapter maps errors into runtime events', () => {
  const event = captureError(new Error('boom'), {
    appName: 'readerapp',
    environment: 'production',
    release: '1.2.3',
    route: '/reader/1',
  });
  assert.equal(event.source, 'adapter');
  assert.equal(event.error.message, 'boom');
  assert.equal(event.route, '/reader/1');
});

test('adapter converts sentry payloads', () => {
  const event = linkSentry({
    environment: 'production',
    release: '1.2.3',
    request: { url: '/reader/1' },
    fingerprint: ['foo', 'bar'],
    exception: { values: [{ type: 'TimeoutError', value: 'request timeout' }] },
  });
  assert.equal(event.source, 'sentry');
  assert.equal(event.route, '/reader/1');
  assert.equal(event.fingerprint, 'foo|bar');
});

test('adapter can install and call the api endpoints', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({ data: 'ok' }),
    };
  };

  const adapter = createSignalForgeAdapter({
    endpoint: 'https://sf.example.com',
    projectKey: 'proj_1',
    appName: 'readerapp',
    environment: 'development',
    release: '1.2.3',
    fetchImpl,
  });

  await adapter.captureFeedback({ body: 'bad button' });
  await adapter.captureError(new Error('boom'));

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/submissions$/);
  assert.match(calls[1].url, /\/runtime-events$/);
});

test('adapter installs browser-style global error handlers', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init: JSON.parse(init.body) });
    return {
      ok: true,
      json: async () => ({ data: 'ok' }),
    };
  };
  const eventTarget = new FakeEventTarget();
  const adapter = createSignalForgeAdapter({
    endpoint: 'https://sf.example.com',
    projectKey: 'proj_1',
    appName: 'readerapp',
    environment: 'production',
    release: '2.0.0',
    fetchImpl,
    target: { location: { pathname: '/reader/99', search: '', hash: '' } },
  });

  const uninstall = adapter.installGlobalErrorHandlers({ eventTarget });
  await eventTarget.dispatch('error', { error: new Error('window boom'), filename: '/reader/99' });
  await eventTarget.dispatch('unhandledrejection', { reason: new Error('async boom') });
  uninstall();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.error.message, 'window boom');
  assert.equal(calls[1].init.fingerprint, 'unhandledrejection');
});

test('feedback widget submits through the adapter', async () => {
  const document = new FakeDocument();
  const root = new FakeElement('div', document);
  const submissions = [];

  const widget = mountFeedbackWidget(root, {
    document,
    context: {
      appName: 'readerapp',
      environment: 'production',
      route: '/reader/7',
    },
    adapter: {
      async captureFeedback(payload) {
        submissions.push(payload);
        return { data: { ok: true } };
      },
    },
    defaultOpen: true,
    includeContactField: true,
  });

  widget.elements.titleInput.value = 'Popup overlaps text';
  widget.elements.bodyInput.value = 'The popup covers the sentence on mobile.';
  widget.elements.contactInput.value = 'user@example.com';
  widget.elements.categorySelect.value = 'bug';
  widget.elements.ratingSelect.value = 'bad';

  await widget.submit();

  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].content.body, 'The popup covers the sentence on mobile.');
  assert.equal(submissions[0].reporter.email, 'user@example.com');
  assert.equal(submissions[0].appContext.route, '/reader/7');
  assert.equal(widget.elements.status.textContent, 'Thanks for the report.');
  assert.equal(widget.elements.panel.hidden, true);
});
