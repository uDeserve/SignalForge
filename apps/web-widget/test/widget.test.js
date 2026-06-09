import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedbackMeshWidget, createSignalForgeWidget } from '../src/index.js';

test('createSignalForgeWidget keeps the provided adapter', () => {
  const adapter = { id: 'adapter_1' };
  const widget = createSignalForgeWidget({ adapter });
  assert.equal(widget.adapter, adapter);
  assert.equal(typeof widget.mount, 'function');
});

test('createFeedbackMeshWidget keeps the provided adapter', () => {
  const adapter = { id: 'adapter_2' };
  const widget = createFeedbackMeshWidget({ adapter });
  assert.equal(widget.adapter, adapter);
  assert.equal(typeof widget.mount, 'function');
});
