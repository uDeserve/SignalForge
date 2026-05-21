import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedbackPayload } from '../src/index.js';

test('buildFeedbackPayload keeps submission shape stable', () => {
  const payload = buildFeedbackPayload({ body: 'hello', source: 'web_widget' });
  assert.equal(payload.source, 'web_widget');
  assert.equal(payload.content.body, 'hello');
  assert.equal(payload.privacy.redactionStatus, 'pending');
});
