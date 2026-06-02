import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignalForgeWidget } from '../src/index.js';

test('createSignalForgeWidget keeps the provided adapter', () => {
  const adapter = { id: 'adapter_1' };
  const widget = createSignalForgeWidget({ adapter });
  assert.equal(widget.adapter, adapter);
  assert.equal(typeof widget.mount, 'function');
});
