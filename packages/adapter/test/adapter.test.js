import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureError,
  createSignalForgeAdapter,
  createSignalForgeContext,
  linkSentry,
} from '../src/index.js';

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
