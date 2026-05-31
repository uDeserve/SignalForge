import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignalForgeApi } from '../src/index.js';
import { createStore } from '../src/store.js';
import { createSubmission, createRuntimeEvent } from '../../../packages/core/src/index.js';
import { createTriageEngine, triageSubmission, triageRuntimeEvent, validateTriageResult } from '../../../packages/triage/src/index.js';
import { createDeepSeekSubmissionAnalyzer } from '../../../packages/triage/src/deepseek.js';
import {
  createGitHubAppJwt,
  createGitHubAppPublisher,
  createGitHubPublisherFromEnv,
  createJwtGitHubAppInstallationTokenProvider,
  buildIssueBody,
  createPatGitHubPublisher,
  createPreviewGitHubPublisher,
  createStaticGitHubAppInstallationTokenProvider,
  parseOwnerCommand,
} from '../../../packages/github-bridge/src/index.js';

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

test('api publish uses injected github publisher result', async () => {
  const githubPublisher = {
    async publishCase({ caseRecord, repo, mode }) {
      return {
        repo,
        mode,
        snapshot: {
          title: caseRecord.canonicalTitle,
          body: caseRecord.canonicalSummary,
          labels: ['source:user-feedback'],
          assignees: [],
        },
        result: {
          externalId: 'gh_issue_123',
          url: `https://github.com/${repo}/issues/99`,
          number: 99,
        },
      };
    },
  };
  const { handleRequest } = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {} },
    githubPublisher,
  });

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
  assert.equal(publishResponse.body.result.externalId, 'gh_issue_123');
  assert.equal(publishResponse.body.result.number, 99);
});

test('github preview publisher returns issue-like publication result', async () => {
  const publisher = createPreviewGitHubPublisher();
  const published = await publisher.publishCase({
    caseRecord: {
      id: 'case_preview_1',
      canonicalTitle: 'Preview issue',
      canonicalSummary: 'Preview body',
      decisionReadiness: { suggestedLabels: ['source:user-feedback'] },
      classification: { primaryType: 'bug', severity: 'medium' },
      evidenceSummary: { submissionCount: 1 },
      publication: { target: 'github_issue' },
      status: 'ready_for_publish',
      metadata: {},
    },
    repo: 'uDeserve/SignalForge',
    mode: 'github_issue',
  });
  assert.equal(published.repo, 'uDeserve/SignalForge');
  assert.equal(published.result.number, 1);
  assert.match(published.result.url, /github\.com\/uDeserve\/SignalForge\/issues\/1/);
});

test('github pat publisher creates issue through github api contract', async () => {
  let request;
  const publisher = createPatGitHubPublisher({
    token: 'test_token',
    apiBaseUrl: 'https://api.github.test',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        async json() {
          return {
            id: 12345,
            number: 7,
            html_url: 'https://github.com/uDeserve/SignalForge/issues/7',
          };
        },
      };
    },
  });

  const published = await publisher.publishCase({
    caseRecord: {
      id: 'case_pat_1',
      canonicalTitle: 'PAT issue',
      canonicalSummary: 'PAT body',
      decisionReadiness: { suggestedLabels: ['source:user-feedback'] },
      classification: { primaryType: 'bug', severity: 'medium' },
      evidenceSummary: { submissionCount: 1 },
      publication: { target: 'github_issue' },
      status: 'ready_for_publish',
      metadata: {},
    },
    repo: 'uDeserve/SignalForge',
    mode: 'github_issue',
  });

  assert.equal(request.url, 'https://api.github.test/repos/uDeserve/SignalForge/issues');
  assert.equal(request.init.method, 'POST');
  assert.match(request.init.headers.Authorization, /Bearer test_token/);
  const payload = JSON.parse(request.init.body);
  assert.deepEqual(payload.assignees, []);
  assert.equal(published.result.number, 7);
  assert.equal(published.result.externalId, '12345');
});

test('github app publisher uses installation token provider contract', async () => {
  let request;
  const publisher = createGitHubAppPublisher({
    appId: '123456',
    installationTokenProvider: createStaticGitHubAppInstallationTokenProvider({
      token: 'installation_token_1',
      installationId: '999',
    }),
    apiBaseUrl: 'https://api.github.test',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        async json() {
          return {
            id: 777,
            number: 11,
            html_url: 'https://github.com/uDeserve/SignalForge/issues/11',
          };
        },
      };
    },
  });

  const published = await publisher.publishCase({
    caseRecord: {
      id: 'case_app_1',
      canonicalTitle: 'App issue',
      canonicalSummary: 'App body',
      decisionReadiness: { suggestedLabels: ['source:user-feedback'] },
      classification: { primaryType: 'bug', severity: 'medium' },
      evidenceSummary: { submissionCount: 1 },
      publication: { target: 'github_issue' },
      status: 'ready_for_publish',
      metadata: {},
    },
    repo: 'uDeserve/SignalForge',
    mode: 'github_issue',
  });

  assert.equal(request.url, 'https://api.github.test/repos/uDeserve/SignalForge/issues');
  assert.match(request.init.headers.Authorization, /Bearer installation_token_1/);
  assert.equal(published.transport.authMode, 'app');
  assert.equal(published.result.number, 11);
});

test('github app jwt creation returns a signed compact token', async () => {
  const { privateKey } = await import('node:crypto').then(({ generateKeyPairSync }) =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }),
  );

  const jwt = await createGitHubAppJwt({
    appId: '123456',
    privateKeyPem: privateKey,
    now: 1_700_000_000,
  });

  const parts = jwt.split('.');
  assert.equal(parts.length, 3);
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.equal(payload.iss, '123456');
});

test('github app jwt creation also accepts pkcs1 rsa private keys', async () => {
  const { privateKey } = await import('node:crypto').then(({ generateKeyPairSync }) =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }),
  );

  const jwt = await createGitHubAppJwt({
    appId: '123456',
    privateKeyPem: privateKey,
    now: 1_700_000_000,
  });

  assert.equal(jwt.split('.').length, 3);
});

test('jwt installation token provider exchanges app jwt for installation token', async () => {
  const { privateKey } = await import('node:crypto').then(({ generateKeyPairSync }) =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }),
  );

  let request;
  const provider = createJwtGitHubAppInstallationTokenProvider({
    appId: '123456',
    privateKeyPem: privateKey,
    installationId: '999',
    apiBaseUrl: 'https://api.github.test',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        async json() {
          return {
            token: 'installation_token_from_exchange',
            expires_at: '2026-05-28T12:00:00Z',
          };
        },
      };
    },
  });

  const installation = await provider.getInstallationToken();
  assert.equal(request.url, 'https://api.github.test/app/installations/999/access_tokens');
  assert.equal(request.init.method, 'POST');
  assert.match(request.init.headers.Authorization, /^Bearer /);
  assert.equal(installation.token, 'installation_token_from_exchange');
});

test('github publisher from env prefers jwt app provider when full app credentials are present', () => {
  const publisher = createGitHubPublisherFromEnv({
    GITHUB_PUBLISHER: 'app',
    GITHUB_APP_ID: '123456',
    GITHUB_APP_INSTALLATION_ID: '999',
    GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----',
    GITHUB_API_BASE_URL: 'https://api.github.test',
  });

  assert.equal(publisher.kind, 'app');
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
