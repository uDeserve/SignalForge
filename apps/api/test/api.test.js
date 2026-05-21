import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignalForgeApi } from '../src/index.js';
import { createStore } from '../src/store.js';
import { createSubmission } from '../../../packages/core/src/index.js';
import { triageSubmission } from '../../../packages/triage/src/index.js';
import { buildIssueBody, parseOwnerCommand } from '../../../packages/github-bridge/src/index.js';

test('triage classifies obvious bug feedback as actionable', () => {
  const submission = createSubmission({
    id: 'sub_1',
    submittedAt: '2026-05-21T00:00:00Z',
    source: 'web_widget',
    content: {
      title: 'Save button freezes',
      body: 'When I click save, the page hangs and returns 500.',
    },
    evidence: {
      runtimeErrors: [{ message: 'timeout' }],
    },
  });

  const result = triageSubmission(submission);
  assert.equal(result.classification.primaryType, 'bug');
  assert.equal(result.actionable, true);
  assert.equal(result.scoring.publishRecommendation, 'github_issue');
});

test('store can persist and retrieve submissions and cases', () => {
  const store = createStore(':memory:');
  const submission = createSubmission({
    id: 'sub_2',
    submittedAt: '2026-05-21T00:00:00Z',
    source: 'web_widget',
    content: { body: 'The app is confusing.' },
  });

  store.saveSubmission(submission);
  const fetched = store.getSubmission('sub_2');
  assert.equal(fetched.id, 'sub_2');
  store.close();
});

test('api accepts submission and exposes triaged case', async () => {
  const { handleRequest } = createSignalForgeApi({ store: createStore(':memory:'), logger: { error() {} } });

  const submissionResponse = await handleRequest({
    method: 'POST',
    url: '/submissions',
    body: {
      source: 'web_widget',
      content: { title: 'Save freezes', body: 'The page hangs on save and returns 500.' },
      evidence: { runtimeErrors: [{ message: 'timeout' }] },
    },
  });
  assert.equal(submissionResponse.statusCode, 201);
  const submissionId = submissionResponse.body.submissionId;

  const triageResponse = await handleRequest({
    method: 'POST',
    url: '/triage/run',
    body: { submissionIds: [submissionId] },
  });
  assert.equal(triageResponse.statusCode, 200);

  const casesResponse = await handleRequest({ method: 'GET', url: '/cases', body: {} });
  assert.equal(casesResponse.statusCode, 200);
  assert.equal(casesResponse.body.items.length, 1);
  assert.equal(casesResponse.body.items[0].classification.primaryType, 'bug');

  const caseId = casesResponse.body.items[0].id;
  const caseResponse = await handleRequest({ method: 'GET', url: `/cases/${caseId}`, body: {} });
  assert.equal(caseResponse.statusCode, 200);
  assert.equal(caseResponse.body.id, caseId);
});

test('github bridge builds issue body and parses owner commands', () => {
  const body = buildIssueBody({
    id: 'case_1',
    canonicalSummary: 'The page hangs on save.',
    status: 'ready_for_publish',
    classification: { primaryType: 'bug', severity: 'high' },
    evidenceSummary: { submissionCount: 2, topErrorFingerprints: ['fp_1'] },
    publication: { target: 'github_issue' },
  });
  assert.match(body, /## Summary/);
  assert.match(body, /Case ID: case_1/);

  const command = parseOwnerCommand('/delegate hermes');
  assert.equal(command.decision, 'delegate_fix');
  assert.equal(command.payload.delegateConfig.skillName, 'hermes');
});

test('api publishes actionable cases and records decisions', async () => {
  const { handleRequest } = createSignalForgeApi({ store: createStore(':memory:'), logger: { error() {} } });

  const submissionResponse = await handleRequest({
    method: 'POST',
    url: '/submissions',
    body: {
      source: 'web_widget',
      content: { title: 'Save freezes', body: 'The page hangs on save and returns 500.' },
      evidence: { runtimeErrors: [{ message: 'timeout' }] },
    },
  });
  const submissionId = submissionResponse.body.submissionId;
  await handleRequest({ method: 'POST', url: '/triage/run', body: { submissionIds: [submissionId] } });
  const casesResponse = await handleRequest({ method: 'GET', url: '/cases', body: {} });
  const caseId = casesResponse.body.items[0].id;

  const publishResponse = await handleRequest({
    method: 'POST',
    url: `/cases/${caseId}/publish`,
    body: { target: { repo: 'uDeserve/SignalForge', mode: 'github_issue' } },
  });
  assert.equal(publishResponse.statusCode, 201);
  assert.equal(publishResponse.body.caseId, caseId);

  const publicationList = await handleRequest({ method: 'GET', url: `/cases/${caseId}/publications`, body: {} });
  assert.equal(publicationList.statusCode, 200);
  assert.equal(publicationList.body.items.length, 1);

  const decisionResponse = await handleRequest({
    method: 'POST',
    url: `/cases/${caseId}/decisions`,
    body: {
      actor: { type: 'owner', id: 'github:alice' },
      commentBody: '/accept',
    },
  });
  assert.equal(decisionResponse.statusCode, 201);
  assert.equal(decisionResponse.body.statusAfterDecision, 'accepted');

  const decisionList = await handleRequest({ method: 'GET', url: `/cases/${caseId}/decisions`, body: {} });
  assert.equal(decisionList.statusCode, 200);
  assert.equal(decisionList.body.items.length, 1);
});

test('api rejects publication for non-actionable cases', async () => {
  const { handleRequest } = createSignalForgeApi({ store: createStore(':memory:'), logger: { error() {} } });

  const submissionResponse = await handleRequest({
    method: 'POST',
    url: '/submissions',
    body: {
      source: 'web_widget',
      content: { body: 'hello' },
    },
  });
  const submissionId = submissionResponse.body.submissionId;
  await handleRequest({ method: 'POST', url: '/triage/run', body: { submissionIds: [submissionId] } });
  const casesResponse = await handleRequest({ method: 'GET', url: '/cases', body: {} });
  const caseId = casesResponse.body.items[0].id;

  const publishResponse = await handleRequest({
    method: 'POST',
    url: `/cases/${caseId}/publish`,
    body: { target: { repo: 'uDeserve/SignalForge', mode: 'github_issue' } },
  });
  assert.equal(publishResponse.statusCode, 422);
});
