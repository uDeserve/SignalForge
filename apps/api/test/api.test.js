import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignalForgeApi } from '../src/index.js';
import { createStore } from '../src/store.js';
import { createSubmission, createRuntimeEvent } from '../../../packages/core/src/index.js';
import { createTriageEngine, triageSubmission, triageRuntimeEvent, validateTriageResult } from '../../../packages/triage/src/index.js';
import { createDeepSeekSubmissionAnalyzer } from '../../../packages/triage/src/deepseek.js';
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
  assert.equal(result.semantic.triageMode, 'heuristic');
});

test('triage treats chinese user-experience feedback as actionable ux instead of noise', () => {
  const submission = createSubmission({
    id: 'sub_cn_ux',
    submittedAt: '2026-05-23T00:00:00Z',
    source: 'web_widget',
    appContext: {
      route: '/reader/book-1/chapter-3',
    },
    content: {
      title: '手机上点词后挡住正文',
      body: '点词后弹层挡住阅读内容，没法顺着往下看，体验不好。',
    },
  });

  const result = triageSubmission(submission);
  assert.equal(result.classification.primaryType, 'ux');
  assert.equal(result.actionable, true);
  assert.equal(result.scoring.publishRecommendation, 'github_issue');
});

test('triage classifies runtime error events as actionable', () => {
  const event = createRuntimeEvent({
    id: 'evt_1',
    occurredAt: '2026-05-22T00:00:00Z',
    environment: 'production',
    route: '/reader/open',
    fingerprint: 'timeout|reader-open',
    error: { type: 'TimeoutError', message: 'Request timeout while opening reader' },
  });

  const result = triageRuntimeEvent(event);
  assert.equal(result.classification.primaryType, 'bug');
  assert.equal(result.actionable, true);
  assert.equal(result.scoring.publishRecommendation, 'github_issue');
  assert.equal(result.semantic.suggestedLabels.includes('source:runtime-signal'), true);
});

test('triage validates llm-shaped outputs', () => {
  const validated = validateTriageResult({
    normalized_summary: 'Mobile popup blocks reading flow',
    problem_type: 'ux',
    affected_surface: 'reader mobile popup',
    user_impact: 'Users cannot continue reading after tapping a word.',
    evidence_used: [{ kind: 'submission', id: 'sub_1' }],
    cluster_key: 'mobile-popup',
    cluster_size_estimate: 3,
    publish_recommendation: 'publish',
    confidence: 0.78,
    open_questions: ['Does this happen on all mobile sizes?'],
    suggested_labels: ['source:user-feedback'],
    suggested_next_action: 'investigate',
  });
  assert.equal(validated.problemType, 'ux');
  assert.equal(validated.clusterSizeEstimate, 3);
});

test('triage engine falls back to heuristic output when analyzer response is invalid', async () => {
  const submission = createSubmission({
    id: 'sub_fallback',
    submittedAt: '2026-05-21T00:00:00Z',
    source: 'web_widget',
    content: { title: 'Save button freezes', body: 'When I click save, the page hangs and returns 500.' },
  });
  const triageEngine = createTriageEngine({
    submissionAnalyzer: async () => ({
      normalized_summary: '',
      problem_type: 'bogus',
    }),
  });

  const result = await triageEngine.triageSubmission(submission);
  assert.equal(result.semantic.triageMode, 'heuristic');
  assert.equal(result.classification.primaryType, 'bug');
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

test('github bridge builds sanitized public issue body and parses owner commands', () => {
  const body = buildIssueBody({
    id: 'case_1',
    canonicalSummary: 'The page hangs on save. Contact me at demo@example.com https://secret.example.com',
    status: 'ready_for_publish',
    classification: { primaryType: 'bug', severity: 'high' },
    evidenceSummary: { submissionCount: 2, topErrorFingerprints: ['fp_1'] },
    publication: { target: 'github_issue' },
    metadata: {
      triage: {
        triageMode: 'llm',
        confidence: 0.82,
        clusterSizeEstimate: 2,
        suggestedNextAction: 'investigate',
        openQuestions: ['Can we reproduce this on mobile?'],
      },
    },
  });
  assert.match(body, /## Summary/);
  assert.match(body, /Case ID: case_1/);
  assert.match(body, /Confidence: 0.82/);
  assert.match(body, /Cluster size: 2/);
  assert.doesNotMatch(body, /demo@example.com/);
  assert.doesNotMatch(body, /secret\.example\.com/);

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

test('api creates delegation and returns case context', async () => {
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

  const delegationResponse = await handleRequest({
    method: 'POST',
    url: '/delegations',
    body: {
      caseId,
      kind: 'skill',
      target: { type: 'skill', name: 'hermes' },
      request: { reason: 'owner_requested', context: { source: 'test' } },
    },
  });
  assert.equal(delegationResponse.statusCode, 201);

  const delegationList = await handleRequest({ method: 'GET', url: `/cases/${caseId}/delegations`, body: {} });
  assert.equal(delegationList.statusCode, 200);
  assert.equal(delegationList.body.items.length, 1);

  const contextResponse = await handleRequest({ method: 'GET', url: `/cases/${caseId}/context`, body: {} });
  assert.equal(contextResponse.statusCode, 200);
  assert.equal(contextResponse.body.case.id, caseId);
  assert.equal(contextResponse.body.delegations.length, 1);
  assert.equal(contextResponse.body.case.status, 'delegated');
});

test('api ingests runtime events and enriches case context', async () => {
  const { handleRequest } = createSignalForgeApi({ store: createStore(':memory:'), logger: { error() {} } });

  const firstEvent = await handleRequest({
    method: 'POST',
    url: '/runtime-events',
    body: {
      source: 'generic_webhook',
      occurredAt: '2026-05-22T00:00:00Z',
      environment: 'production',
      release: '1.0.0',
      route: '/reader/open',
      fingerprint: 'timeout|reader-open',
      error: { type: 'TimeoutError', message: 'Request timeout while opening reader' },
    },
  });
  assert.equal(firstEvent.statusCode, 201);
  const caseId = firstEvent.body.caseId;

  const secondEvent = await handleRequest({
    method: 'POST',
    url: '/runtime-events/ingest/sentry',
    body: {
      timestamp: '2026-05-22T00:01:00Z',
      environment: 'production',
      release: '1.0.0',
      request: { url: '/reader/open?uid=123456' },
      fingerprint: ['timeout', 'reader-open'],
      exception: {
        values: [
          { type: 'TimeoutError', value: 'Request timeout while opening reader' },
        ],
      },
    },
  });
  assert.equal(secondEvent.statusCode, 201);
  assert.equal(secondEvent.body.caseId, caseId);

  const contextResponse = await handleRequest({ method: 'GET', url: `/cases/${caseId}/context`, body: {} });
  assert.equal(contextResponse.statusCode, 200);
  assert.equal(contextResponse.body.runtimeEvents.length, 2);
  assert.equal(contextResponse.body.case.evidenceSummary.runtimeEventCount, 2);
  const issueBody = buildIssueBody(contextResponse.body.case, { publicRepo: true });
  assert.match(issueBody, /Runtime events: 2/);
  assert.match(issueBody, /Environments: production/);
});

test('api can use llm-assisted triage engine output for publication-ready metadata', async () => {
  const triageEngine = createTriageEngine({
    submissionAnalyzer: async () => ({
      triage_mode: 'llm',
      normalized_summary: 'Mobile lookup popup blocks reading flow.',
      problem_type: 'ux',
      affected_surface: 'reader mobile lookup popup',
      user_impact: 'Users cannot continue reading smoothly on mobile.',
      evidence_used: [{ kind: 'submission', id: 'sub_1' }],
      cluster_key: 'mobile-lookup-popup',
      cluster_action: 'merge_existing',
      cluster_size_estimate: 4,
      publish_recommendation: 'publish',
      confidence: 0.78,
      open_questions: ['Does this happen on every small screen?'],
      suggested_labels: ['type:ux', 'cluster:multi-user'],
      suggested_next_action: 'investigate',
    }),
  });
  const { handleRequest } = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    triageEngine,
  });

  const submissionResponse = await handleRequest({
    method: 'POST',
    url: '/submissions',
    body: {
      source: 'web_widget',
      content: {
        title: '手机点词后挡住正文',
        body: '点词后弹层挡住阅读内容，没法顺着往下看。',
      },
    },
  });
  const submissionId = submissionResponse.body.submissionId;
  await handleRequest({ method: 'POST', url: '/triage/run', body: { submissionIds: [submissionId] } });
  const casesResponse = await handleRequest({ method: 'GET', url: '/cases', body: {} });
  const caseRecord = casesResponse.body.items[0];

  assert.equal(caseRecord.classification.primaryType, 'ux');
  assert.equal(caseRecord.metadata.triage.triageMode, 'llm');
  assert.equal(caseRecord.metadata.triage.clusterSizeEstimate, 4);
  assert.equal(caseRecord.decisionReadiness.suggestedLabels.includes('decision:pending'), true);
  assert.equal(caseRecord.publication.target, 'github_issue');
});

test('deepseek analyzer maps openai-compatible json output', async () => {
  const analyzer = createDeepSeekSubmissionAnalyzer({
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                triage_mode: 'llm',
                normalized_summary: 'Mobile lookup popup blocks reading flow.',
                problem_type: 'ux',
                affected_surface: 'reader mobile lookup popup',
                user_impact: 'Users cannot continue reading smoothly.',
                evidence_used: [{ kind: 'submission', id: 'sub_1' }],
                cluster_key: 'mobile-lookup-popup',
                cluster_action: 'merge_existing',
                cluster_size_estimate: 4,
                publish_recommendation: 'publish',
                confidence: 0.77,
                open_questions: ['Does this happen on all small screens?'],
                suggested_labels: ['type:ux'],
                suggested_next_action: 'investigate',
              }),
            },
          },
        ],
      }),
    }),
  });

  const result = await analyzer({
    submissions: [],
    runtimeEvents: [],
    existingClusters: [],
    policy: { publishBias: 'lenient', privacyMode: 'strict' },
  });

  assert.equal(result.problem_type, 'ux');
  assert.equal(result.publish_recommendation, 'publish');
});
