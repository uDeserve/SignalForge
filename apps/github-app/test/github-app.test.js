import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createSignalForgeGithubApp } from '../src/index.js';
import { createStore } from '../../api/src/store.js';
import { createCase, CaseStatus, PublicationTarget } from '../../../packages/core/src/index.js';
import { createIssuePublication } from '../../../packages/github-bridge/src/index.js';

function sign(body, secret) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

test('github app verifies signatures and handles ping', async () => {
  const secret = 'secret';
  const { handleWebhook } = createSignalForgeGithubApp({ store: createStore(':memory:'), secret, logger: { error() {} } });
  const body = JSON.stringify({ zen: 'keep it logically awesome' });
  const response = await handleWebhook({
    headers: {
      'x-github-event': 'ping',
      'x-hub-signature-256': sign(body, secret),
    },
    rawBody: body,
    body: JSON.parse(body),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.message, 'pong');
});

test('github app turns owner commands into decisions', async () => {
  const store = createStore(':memory:');
  const { handleWebhook } = createSignalForgeGithubApp({ store, secret: 'secret', logger: { error() {} } });
  const caseRecord = createCase({
    id: 'case_1',
    createdAt: '2026-05-21T00:00:00Z',
    updatedAt: '2026-05-21T00:00:00Z',
    status: CaseStatus.published,
    canonicalTitle: 'Save freezes',
    canonicalSummary: 'The page hangs.',
    publication: { target: PublicationTarget.github_issue, published: true, primaryPublicationId: 'pub_1' },
  });
  store.upsertCase(caseRecord, 'fingerprint-1');
  store.savePublication(createIssuePublication(caseRecord, {
    repo: 'uDeserve/FeedbackMesh',
    externalId: 'issue_1',
    url: 'https://github.com/uDeserve/FeedbackMesh/issues/1',
    number: 1,
  }));

  const payload = {
    action: 'created',
    repository: { full_name: 'uDeserve/FeedbackMesh' },
    issue: { number: 1, state: 'open', title: 'Save freezes', body: '...' },
    comment: { body: '/accept' },
    sender: { login: 'alice' },
  };
  const rawBody = JSON.stringify(payload);
  const response = await handleWebhook({
    headers: {
      'x-github-event': 'issue_comment',
      'x-hub-signature-256': sign(rawBody, 'secret'),
    },
    rawBody,
    body: payload,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.statusAfterDecision, 'accepted');

  const updated = store.getCase('case_1');
  assert.equal(updated.status, 'accepted');
  assert.equal(store.listDecisions('case_1').length, 1);
});

test('github app syncs issue close events back to the case', async () => {
  const store = createStore(':memory:');
  const { handleWebhook } = createSignalForgeGithubApp({ store, secret: 'secret', logger: { error() {} } });
  const caseRecord = createCase({
    id: 'case_2',
    createdAt: '2026-05-21T00:00:00Z',
    updatedAt: '2026-05-21T00:00:00Z',
    status: CaseStatus.published,
    canonicalTitle: 'Save freezes',
    canonicalSummary: 'The page hangs.',
    publication: { target: PublicationTarget.github_issue, published: true, primaryPublicationId: 'pub_2' },
  });
  store.upsertCase(caseRecord, 'fingerprint-2');
  store.savePublication(createIssuePublication(caseRecord, {
    repo: 'uDeserve/FeedbackMesh',
    externalId: 'issue_2',
    url: 'https://github.com/uDeserve/FeedbackMesh/issues/2',
    number: 2,
  }));

  const payload = {
    action: 'closed',
    repository: { full_name: 'uDeserve/FeedbackMesh' },
    issue: { number: 2, state: 'closed', title: 'Save freezes', body: '...' },
    sender: { login: 'alice' },
  };
  const rawBody = JSON.stringify(payload);
  const response = await handleWebhook({
    headers: {
      'x-github-event': 'issues',
      'x-hub-signature-256': sign(rawBody, 'secret'),
    },
    rawBody,
    body: payload,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(store.getCase('case_2').status, 'closed');
});
