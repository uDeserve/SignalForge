import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignalForgeApi } from '../src/index.js';
import { createStore } from '../src/store.js';
import { createSubmission, createRuntimeEvent } from '../../../packages/core/src/index.js';
import { createTriageEngine, triageSubmission, triageRuntimeEvent, validateTriageResult } from '../../../packages/triage/src/index.js';
import { createDeepSeekSubmissionAnalyzer } from '../../../packages/triage/src/deepseek.js';
import {
  createGitHubAppJwt,
  getGitHubAppInstallationForRepo,
  createGitHubAppPublisher,
  createGitHubPublisherFromEnv,
  createRepoAwareJwtGitHubAppInstallationTokenProvider,
  createJwtGitHubAppInstallationTokenProvider,
  buildIssueBody,
  createPatGitHubPublisher,
  createPreviewGitHubPublisher,
  createStaticGitHubAppInstallationTokenProvider,
  parseOwnerCommand,
} from '../../../packages/github-bridge/src/index.js';

async function createSubmittedCase(api, body, options = {}) {
  const submissionResponse = await api.handleRequest({
    method: 'POST',
    url: '/submissions',
    body,
    headers: options.headers ?? {},
  });
  const submissionId = submissionResponse.body.submissionId;
  await api.handleRequest({
    method: 'POST',
    url: '/triage/run',
    body: { submissionIds: [submissionId] },
    headers: options.headers ?? {},
  });
  const casesResponse = await api.handleRequest({
    method: 'GET',
    url: options.casesUrl ?? '/cases',
    body: {},
    headers: options.headers ?? {},
  });
  return casesResponse.body.items[0];
}

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
  assert.match(result.fingerprint, /^feedback:/);
});

test('triage treats chinese user-experience feedback as actionable ux instead of noise', () => {
  const submission = createSubmission({
    id: 'sub_cn_ux',
    submittedAt: '2026-05-23T00:00:00Z',
    source: 'web_widget',
    appContext: {
      route: '/reader/book-1/chapter-3',
      feature: 'reader_lookup',
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
  assert.equal(result.semantic.clusterAction, 'new_cluster');
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
  assert.match(result.fingerprint, /^runtime:/);
});

test('triage validates llm-shaped outputs including clustering metadata', () => {
  const validated = validateTriageResult({
    normalized_summary: 'Mobile popup blocks reading flow',
    problem_type: 'ux',
    affected_surface: 'reader mobile popup',
    user_impact: 'Users cannot continue reading after tapping a word.',
    evidence_used: [{ kind: 'submission', id: 'sub_1' }],
    cluster_key: 'mobile-popup',
    cluster_action: 'merge_existing',
    cluster_size_estimate: 3,
    cluster_signals: { route: '/reader/:id', sourceKind: 'user_feedback' },
    publish_recommendation: 'publish',
    confidence: 0.78,
    open_questions: ['Does this happen on all mobile sizes?'],
    suggested_labels: ['source:user-feedback'],
    suggested_next_action: 'investigate',
  });
  assert.equal(validated.problemType, 'ux');
  assert.equal(validated.clusterSizeEstimate, 3);
  assert.equal(validated.clusterSignals.route, '/reader/:id');
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
  assert.match(result.fingerprint, /^feedback:/);
});

test('store can persist and retrieve submissions and cases', () => {
  const store = createStore(':memory:');
  const submission = createSubmission({
    id: 'sub_2',
    submittedAt: '2026-05-21T00:00:00Z',
    source: 'web_widget',
    reporter: { id: 'user_1' },
    content: { body: 'The app is confusing.' },
  });

  store.saveSubmission(submission);
  const fetched = store.getSubmission('sub_2');
  assert.equal(fetched.id, 'sub_2');
  assert.equal(store.countUniqueReportersForSubmissionIds(['sub_2']), 1);
  store.close();
});

test('api merges two similar feedback submissions into one aggregated case', async () => {
  const api = createSignalForgeApi({ store: createStore(':memory:'), logger: { error() {}, warn() {} } });

  const submissionBodies = [
    {
      source: 'web_widget',
      reporter: { id: 'user_a' },
      appContext: { route: '/reader/book-1/chapter-3', feature: 'reader_lookup', release: '1.0.0' },
      content: { title: '手机上点词后挡住正文', body: '点词后弹层挡住阅读内容，没法顺着往下看。' },
    },
    {
      source: 'web_widget',
      reporter: { id: 'user_b' },
      appContext: { route: '/reader/book-9/chapter-2', feature: 'reader_lookup', release: '1.0.1' },
      content: { title: '查词弹层遮住正文', body: '手机上查词后弹层把正文挡住了，阅读没法继续。' },
    },
  ];

  const submissionIds = [];
  for (const body of submissionBodies) {
    const submissionResponse = await api.handleRequest({ method: 'POST', url: '/submissions', body });
    submissionIds.push(submissionResponse.body.submissionId);
  }

  const triageResponse = await api.handleRequest({
    method: 'POST',
    url: '/triage/run',
    body: { submissionIds },
  });

  assert.equal(triageResponse.statusCode, 200);
  assert.equal(triageResponse.body.created, 1);
  assert.equal(triageResponse.body.merged, 1);

  const casesResponse = await api.handleRequest({ method: 'GET', url: '/cases', body: {} });
  assert.equal(casesResponse.body.items.length, 1);
  const caseRecord = casesResponse.body.items[0];
  assert.equal(caseRecord.submissionCount, 2);
  assert.equal(caseRecord.uniqueReporterCount, 2);
  assert.equal(caseRecord.publishPolicyOutcome, 'hold_and_watch');
  assert.equal(caseRecord.publication.published, true);
  assert.equal(caseRecord.status, 'published');
  assert.match(caseRecord.canonicalTitle, /Reader popup blocks reading content/i);
});

test('api keeps dissimilar submissions in separate cases', async () => {
  const api = createSignalForgeApi({ store: createStore(':memory:'), logger: { error() {}, warn() {} } });

  const first = await createSubmittedCase(api, {
    source: 'web_widget',
    reporter: { id: 'bug_user' },
    appContext: { route: '/reader/save', feature: 'save_flow', release: '1.2.0' },
    content: { title: 'Save freezes', body: 'Save freezes and returns 500.' },
    evidence: { runtimeErrors: [{ message: 'timeout', fingerprint: 'save-timeout' }] },
  });
  const second = await createSubmittedCase(api, {
    source: 'web_widget',
    reporter: { id: 'feature_user' },
    appContext: { route: '/reader/export', feature: 'export_menu', release: '1.2.0' },
    content: { title: 'Please add export support', body: 'I would like export to markdown.' },
  });

  const casesResponse = await api.handleRequest({ method: 'GET', url: '/cases', body: {} });
  assert.equal(casesResponse.body.items.length, 2);
  assert.notEqual(first.id, second.id);
});

test('api exposes shared setup status for install and verification flows', async () => {
  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    env: { GITHUB_PUBLISHER: 'preview' },
    repoRoot: '/tmp/signalforge-setup-status-test',
  });

  const response = await api.handleRequest({
    method: 'GET',
    url: '/setup/status',
    body: {},
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.schemaVersion, 2);
  assert.equal(response.body.publisherMode, 'preview');
  assert.equal(typeof response.body.setupStages, 'object');
  assert.equal(response.body.setupStages.appConnected, false);
  assert.equal(response.body.existingWebAppTrialReady, false);
  assert.equal(response.body.githubAppConnection.mode, 'not_app');
  assert.equal(Array.isArray(response.body.checks), true);
});

test('setup page renders a hosted post-install landing page', async () => {
  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    env: {
      SIGNALFORGE_PUBLIC_BASE_URL: 'https://feedbackmesh.launchhub.icu',
      GITHUB_APP_SLUG: 'signalforge',
    },
  });

  const response = await api.handleRequest({
    method: 'GET',
    url: '/setup?installation_id=12345&setup_action=install&repository_selection=selected',
    body: {},
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(response.body, /FeedbackMesh Setup/);
  assert.match(response.body, /GitHub App Installed\. Complete The Agent-First Loop\./);
  assert.match(response.body, /Installation ID/);
  assert.match(response.body, /12345/);
  assert.match(response.body, /https:\/\/github\.com\/apps\/signalforge\/installations\/new/);
  assert.match(response.body, /https:\/\/feedbackmesh\.launchhub\.icu\/setup\/status/);
});

test('hosted onboarding can create a project with reusable client config', async () => {
  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    env: { SIGNALFORGE_PUBLIC_BASE_URL: 'https://sf.example.com' },
  });

  const response = await api.handleRequest({
    method: 'POST',
    url: '/projects',
    body: {
      name: 'Omni Lingua',
      appName: 'omni_lingua',
      repo: {
        owner: 'uDeserve',
        name: 'omni_lingua',
      },
    },
  });

  assert.equal(response.statusCode, 201);
  assert.match(response.body.projectKey, /^proj_omni_lingua_/);
  assert.equal(response.body.slug, 'omni-lingua');
  assert.equal(response.body.hosted.endpoint, 'https://sf.example.com');
  assert.equal(response.body.hosted.clientConfig.projectKey, response.body.projectKey);
  assert.equal(response.body.hosted.env.VITE_SIGNALFORGE_PROJECT_KEY, response.body.projectKey);
});

test('agent-first setup session returns install link, env patch, and current stage', async () => {
  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    env: {
      SIGNALFORGE_PUBLIC_BASE_URL: 'https://sf.example.com',
      GITHUB_APP_SLUG: 'signalforge',
    },
  });

  const created = await api.handleRequest({
    method: 'POST',
    url: '/setup/sessions',
    body: {
      name: 'Omni Lingua',
      appName: 'omni_lingua',
      repo: {
        owner: 'uDeserve',
        name: 'omni_lingua',
      },
      actor: {
        type: 'agent',
        id: 'codex',
      },
    },
  });

  assert.equal(created.statusCode, 201);
  assert.equal(created.body.state.currentStage, 'awaiting_github_app_install');
  assert.equal(created.body.state.blockingHumanAction.type, 'github_app_install');
  assert.match(created.body.state.installUrl, /^https:\/\/github\.com\/apps\/signalforge\/installations\/new/);
  assert.match(created.body.state.binding.code, /^sfbind_/);
  assert.equal(created.body.state.binding.confirmed, false);
  assert.equal(created.body.state.stages.binding_code_issued, true);
  assert.equal(created.body.project.hosted.env.VITE_SIGNALFORGE_PROJECT_KEY, created.body.project.projectKey);

  const contract = await api.handleRequest({
    method: 'GET',
    url: `/setup/sessions/${created.body.id}/agent-contract`,
    body: {},
  });

  assert.equal(contract.statusCode, 200);
  assert.equal(contract.body.mode, 'agent_first_hosted_onboarding');
  assert.equal(contract.body.instructions.nextAgentAction, 'wait_for_human_github_install_then_poll_setup_session');
  assert.equal(contract.body.machineConfig.projectKey, created.body.project.projectKey);
  assert.equal(contract.body.api.statusUrl, `https://sf.example.com/setup/sessions/${created.body.id}`);
  assert.equal(contract.body.binding.code, created.body.state.binding.code);
  assert.equal(contract.body.instructions.binding.code, created.body.state.binding.code);
  assert.match(contract.body.instructions.blockingHumanAction.description, /refresh the setup session/i);
});

test('setup session auto-confirms binding after install is detected for the target repo', async () => {
  const { privateKey } = await import('node:crypto').then(({ generateKeyPairSync }) =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }),
  );

  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    env: {
      SIGNALFORGE_PUBLIC_BASE_URL: 'https://sf.example.com',
      GITHUB_APP_ID: '123',
      GITHUB_APP_PRIVATE_KEY: privateKey,
      GITHUB_API_BASE_URL: 'https://api.github.test',
      GITHUB_APP_SLUG: 'signalforge',
    },
    fetchImpl: async (url) => {
      if (String(url).endsWith('/repos/uDeserve/reader_lab/installation')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 1001,
            app_id: 123,
            app_slug: 'signalforge',
            account: { login: 'uDeserve', type: 'User' },
            target_type: 'Repository',
            repository_selection: 'selected',
            permissions: {
              issues: 'write',
              metadata: 'read',
            },
            events: ['issues', 'issue_comment'],
            html_url: 'https://github.com/apps/signalforge',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: 'jwt-or-token-placeholder' }),
        text: async () => '',
      };
    },
  });

  const created = await api.handleRequest({
    method: 'POST',
    url: '/setup/sessions',
    body: {
      name: 'Reader Lab',
      appName: 'reader_lab',
      repo: { owner: 'uDeserve', name: 'reader_lab' },
      actor: { type: 'agent', id: 'codex' },
    },
  });

  assert.equal(created.statusCode, 201);
  assert.equal(created.body.state.binding.confirmed, true);
  assert.equal(created.body.state.binding.repo, 'uDeserve/reader_lab');
  assert.equal(created.body.state.binding.installationId, '1001');
  assert.equal(created.body.state.currentStage, 'awaiting_first_submission');
  assert.equal(created.body.state.stages.install_binding_confirmed, true);
  assert.equal(created.body.project.github.repo, 'uDeserve/reader_lab');
  assert.equal(created.body.project.github.installationConnected, true);
  assert.equal(created.body.project.github.status, 'ready');

  const contract = await api.handleRequest({
    method: 'GET',
    url: `/setup/sessions/${created.body.id}/agent-contract`,
    body: {},
  });

  assert.equal(contract.statusCode, 200);
  assert.equal(contract.body.instructions.nextAgentAction, 'patch_target_app_and_send_first_submission');
  assert.equal(contract.body.instructions.binding.confirmed, true);
});

test('setup session can refresh binding code and reject stale confirmation', async () => {
  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    env: {
      SIGNALFORGE_PUBLIC_BASE_URL: 'https://sf.example.com',
      GITHUB_APP_SLUG: 'signalforge',
    },
  });

  const created = await api.handleRequest({
    method: 'POST',
    url: '/setup/sessions',
    body: {
      name: 'Reader Lab',
      appName: 'reader_lab',
      repo: { owner: 'uDeserve', name: 'reader_lab' },
    },
  });

  const originalCode = created.body.state.binding.code;
  const refreshed = await api.handleRequest({
    method: 'POST',
    url: `/setup/sessions/${created.body.id}/binding-code/refresh`,
    body: {},
  });

  assert.equal(refreshed.statusCode, 200);
  assert.notEqual(refreshed.body.state.binding.code, originalCode);
  assert.equal(refreshed.body.state.binding.confirmed, false);

  const rejected = await api.handleRequest({
    method: 'POST',
    url: `/setup/sessions/${created.body.id}/github-binding`,
    body: {
      bindingCode: originalCode,
      repo: 'uDeserve/reader_lab',
    },
  });

  assert.equal(rejected.statusCode, 422);
  assert.equal(rejected.error.code, 'invalid_binding_code');
});

test('setup session github binding confirmation updates project and stage', async () => {
  const { privateKey } = await import('node:crypto').then(({ generateKeyPairSync }) =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }),
  );

  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    env: {
      SIGNALFORGE_PUBLIC_BASE_URL: 'https://sf.example.com',
      GITHUB_APP_ID: '123',
      GITHUB_APP_PRIVATE_KEY: privateKey,
      GITHUB_API_BASE_URL: 'https://api.github.test',
      GITHUB_APP_SLUG: 'signalforge',
    },
    fetchImpl: async (url) => {
      if (String(url).endsWith('/repos/uDeserve/reader_lab/installation')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 1001,
            app_id: 123,
            app_slug: 'signalforge',
            account: { login: 'uDeserve', type: 'User' },
            target_type: 'Repository',
            repository_selection: 'selected',
            permissions: {
              issues: 'write',
              metadata: 'read',
            },
            events: ['issues', 'issue_comment'],
            html_url: 'https://github.com/apps/signalforge',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: 'jwt-or-token-placeholder' }),
        text: async () => '',
      };
    },
  });

  const created = await api.handleRequest({
    method: 'POST',
    url: '/setup/sessions',
    body: {
      name: 'Reader Lab',
      appName: 'reader_lab',
      actor: { type: 'agent', id: 'codex' },
    },
  });

  const confirmed = await api.handleRequest({
    method: 'POST',
    url: `/setup/sessions/${created.body.id}/github-binding`,
    body: {
      bindingCode: created.body.state.binding.code,
      repo: 'uDeserve/reader_lab',
      installationId: '1001',
      actor: { type: 'agent', id: 'codex' },
    },
  });

  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.body.state.binding.confirmed, true);
  assert.equal(confirmed.body.state.binding.repo, 'uDeserve/reader_lab');
  assert.equal(confirmed.body.state.binding.installationId, '1001');
  assert.equal(confirmed.body.state.currentStage, 'awaiting_first_submission');
  assert.equal(confirmed.body.state.stages.install_binding_confirmed, true);
  assert.equal(confirmed.body.project.github.repo, 'uDeserve/reader_lab');
  assert.equal(confirmed.body.project.github.installationConnected, true);
  assert.equal(confirmed.body.project.github.status, 'ready');
});

test('hosted project can refresh github app installation state', async () => {
  const { privateKey } = await import('node:crypto').then(({ generateKeyPairSync }) =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }),
  );

  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    env: {
      SIGNALFORGE_PUBLIC_BASE_URL: 'https://sf.example.com',
      GITHUB_APP_ID: '123',
      GITHUB_APP_PRIVATE_KEY: privateKey,
      GITHUB_API_BASE_URL: 'https://api.github.test',
    },
    fetchImpl: async (url) => {
      if (String(url).endsWith('/repos/uDeserve/omni_lingua/installation')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 999,
            app_id: 123,
            app_slug: 'signalforge',
            account: { login: 'uDeserve', type: 'User' },
            target_type: 'Repository',
            repository_selection: 'selected',
            permissions: {
              issues: 'write',
              metadata: 'read',
            },
            events: ['issues', 'issue_comment'],
            html_url: 'https://github.com/apps/signalforge',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: 'jwt-or-token-placeholder' }),
        text: async () => '',
      };
    },
  });

  const projectResponse = await api.handleRequest({
    method: 'POST',
    url: '/projects',
    body: {
      name: 'Omni Lingua',
      appName: 'omni_lingua',
      repo: {
        owner: 'uDeserve',
        name: 'omni_lingua',
      },
    },
  });

  const refresh = await api.handleRequest({
    method: 'POST',
    url: `/projects/${projectResponse.body.id}/github-connection/refresh`,
    body: {},
  });

  assert.equal(refresh.statusCode, 200);
  assert.equal(refresh.body.github.connected, true);
  assert.equal(refresh.body.github.installationId, '999');
  assert.equal(refresh.body.github.permissionsOk, true);
  assert.equal(refresh.body.github.eventsOk, true);
  assert.equal(refresh.body.github.status, 'ready');
});

test('hosted mode requires a valid project key for submissions once projects exist', async () => {
  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
  });

  const projectResponse = await api.handleRequest({
    method: 'POST',
    url: '/projects',
    body: {
      name: 'Reader App',
      appName: 'readerapp',
    },
  });
  assert.equal(projectResponse.statusCode, 201);

  const unauthorized = await api.handleRequest({
    method: 'POST',
    url: '/submissions',
    body: {
      source: 'web_widget',
      content: { title: 'Missing key', body: 'This should fail without a project key.' },
    },
  });

  assert.equal(unauthorized.statusCode, 401);
  assert.match(unauthorized.error.message, /project-key/i);

  const authorized = await api.handleRequest({
    method: 'POST',
    url: '/submissions',
    headers: {
      'X-SignalForge-Project-Key': projectResponse.body.projectKey,
    },
    body: {
      source: 'web_widget',
      reporter: { id: 'user_1' },
      content: { title: 'Authorized feedback', body: 'This should be accepted.' },
    },
  });

  assert.equal(authorized.statusCode, 201);
  assert.equal(authorized.body.project.projectKey, projectResponse.body.projectKey);
});

test('api verify run returns setup triage publish and decision-sync verification state', async () => {
  const githubPublisher = {
    async publishCase({ repo }) {
      return {
        repo,
        mode: 'github_issue',
        snapshot: {
          title: 'Verify issue',
          body: 'Verify body',
          labels: ['source:user-feedback'],
          assignees: [],
        },
        result: {
          externalId: 'gh_issue_verify_1',
          url: `https://github.com/${repo}/issues/1`,
          number: 1,
        },
      };
    },
  };

  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    githubPublisher,
    env: { GITHUB_PUBLISHER: 'preview' },
    repoRoot: '/tmp/signalforge-verify-test',
  });

  const response = await api.handleRequest({
    method: 'POST',
    url: '/verify/run',
    body: {
      target: { repo: 'uDeserve/signalforge-e2e-lab' },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.schemaVersion, 1);
  assert.equal(response.body.submission.accepted, true);
  assert.equal(typeof response.body.triage.caseId, 'string');
  assert.equal(response.body.publish.ok, true);
  assert.equal(response.body.publish.result.url, 'https://github.com/uDeserve/signalforge-e2e-lab/issues/1');
  assert.equal(response.body.decisionSync.ready, false);
});

test('agent contract exposes explicit published state after the first hosted publish', async () => {
  const { privateKey } = await import('node:crypto').then(({ generateKeyPairSync }) =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }),
  );

  let publishCount = 0;
  const githubPublisher = {
    async publishCase({ repo, caseRecord, mode }) {
      publishCount += 1;
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
          externalId: 'gh_issue_hosted_1',
          url: `https://github.com/${repo}/issues/1`,
          number: 1,
        },
      };
    },
  };
  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    githubPublisher,
    env: {
      SIGNALFORGE_PUBLIC_BASE_URL: 'https://sf.example.com',
      GITHUB_APP_SLUG: 'signalforge',
      GITHUB_APP_ID: '123',
      GITHUB_APP_PRIVATE_KEY: privateKey,
      GITHUB_APP_INSTALLATION_ID: '999',
      GITHUB_WEBHOOK_SECRET: 'secret',
      GITHUB_PUBLISHER: 'app',
      SIGNALFORGE_E2E_REPO: 'uDeserve/signalforge-e2e-lab',
    },
    repoRoot: '/tmp/signalforge-agent-contract-publish-test',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/repos/uDeserve/signalforge-e2e-lab/installation')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 999,
            app_id: 123,
            app_slug: 'signalforge',
            account: { login: 'uDeserve', type: 'User' },
            target_type: 'Repository',
            repository_selection: 'selected',
            permissions: {
              issues: 'write',
              metadata: 'read',
            },
            events: ['issues', 'issue_comment'],
            html_url: 'https://github.com/apps/signalforge',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: 'jwt-or-token-placeholder' }),
        text: async () => '',
      };
    },
    fileSystem: {
      existsSync(target) {
        const normalized = String(target).replace(/\\/g, '/');
        return normalized.endsWith('/.env') ||
          normalized.endsWith('/scripts/run_github_app_publish_e2e.mjs') ||
          normalized.endsWith('/scripts/run_readerapp_feedback_sample.mjs');
      },
      readFileSync() {
        return '';
      },
    },
  });

  const created = await api.handleRequest({
    method: 'POST',
    url: '/setup/sessions',
    body: {
      name: 'Hosted Publish Probe',
      appName: 'hosted_publish_probe',
      repo: { owner: 'uDeserve', name: 'signalforge-e2e-lab' },
      actor: { type: 'agent', id: 'codex' },
    },
  });
  const sessionId = created.body.id;
  const bindingCode = created.body.state.binding.code;
  const projectKey = created.body.project.projectKey;

  const bound = await api.handleRequest({
    method: 'POST',
    url: `/setup/sessions/${sessionId}/github-binding`,
    body: {
      bindingCode,
      repo: 'uDeserve/signalforge-e2e-lab',
      installationId: '999',
      actor: { type: 'agent', id: 'codex' },
    },
  });
  assert.equal(bound.statusCode, 200);
  assert.equal(bound.body.state.currentStage, 'awaiting_first_submission');

  const submission = await api.handleRequest({
    method: 'POST',
    url: '/submissions',
    headers: { 'x-signalforge-project-key': projectKey },
    body: {
      source: 'adapter',
      reporter: { id: 'hosted_user_1' },
      appContext: {
        appName: 'hosted_publish_probe',
        environment: 'production',
        release: '1.0.0',
        route: '/reader/probe',
        feature: 'reader_feedback',
      },
      content: {
        title: 'Hosted publish probe',
        body: 'Reader popup blocks reading on mobile and should publish once.',
        categoryHint: 'feedback',
      },
      evidence: {},
      privacy: { containsPii: false, redactionStatus: 'pending' },
      raw: { source: 'hosted_publish_probe' },
    },
  });

  await api.handleRequest({
    method: 'POST',
    url: '/triage/run',
    headers: { 'x-signalforge-project-key': projectKey },
    body: { submissionIds: [submission.body.submissionId] },
  });
  assert.equal(publishCount, 1);

  const session = await api.handleRequest({
    method: 'GET',
    url: `/setup/sessions/${sessionId}`,
    body: {},
  });
  assert.equal(session.statusCode, 200);
  assert.equal(session.body.state.currentStage, 'live');
  assert.equal(session.body.state.verify.publish.status, 'published');
  assert.equal(session.body.state.verify.publish.alreadyPublished, true);
  assert.equal(session.body.state.verify.publish.issueUrl, 'https://github.com/uDeserve/signalforge-e2e-lab/issues/1');
  assert.equal(session.body.state.verify.nextAgentAction, 'monitor_live_project');

  const contract = await api.handleRequest({
    method: 'GET',
    url: `/setup/sessions/${sessionId}/agent-contract`,
    body: {},
  });
  assert.equal(contract.statusCode, 200);
  assert.equal(contract.body.instructions.publish.status, 'published');
  assert.equal(contract.body.instructions.publish.alreadyPublished, true);
  assert.equal(contract.body.instructions.publish.issueUrl, 'https://github.com/uDeserve/signalforge-e2e-lab/issues/1');
  assert.equal(publishCount, 1);
});

test('similar feedback from different hosted projects stays in separate cases', async () => {
  const api = createSignalForgeApi({ store: createStore(':memory:'), logger: { error() {}, warn() {} } });

  const projectA = await api.handleRequest({
    method: 'POST',
    url: '/projects',
    body: { name: 'Reader A', appName: 'reader_a' },
  });
  const projectB = await api.handleRequest({
    method: 'POST',
    url: '/projects',
    body: { name: 'Reader B', appName: 'reader_b' },
  });

  const payload = {
    source: 'web_widget',
    reporter: { id: 'user_1' },
    appContext: { route: '/reader/book-1/chapter-3', feature: 'reader_lookup', release: '1.0.0' },
    content: { title: '手机上点词后挡住正文', body: '点词后弹层挡住阅读内容，没法顺着往下看。' },
  };

  const first = await createSubmittedCase(api, payload, {
    headers: { 'X-SignalForge-Project-Key': projectA.body.projectKey },
    casesUrl: `/cases?projectKey=${projectA.body.projectKey}`,
  });
  const second = await createSubmittedCase(api, payload, {
    headers: { 'X-SignalForge-Project-Key': projectB.body.projectKey },
    casesUrl: `/cases?projectKey=${projectB.body.projectKey}`,
  });

  assert.notEqual(first.id, second.id);

  const casesResponse = await api.handleRequest({
    method: 'GET',
    url: '/cases',
    body: {},
  });
  assert.equal(casesResponse.body.items.length, 2);

  const projectOnly = await api.handleRequest({
    method: 'GET',
    url: `/cases?projectKey=${projectA.body.projectKey}`,
    body: {},
  });
  assert.equal(projectOnly.body.items.length, 1);
  assert.equal(projectOnly.body.items[0].project.projectKey, projectA.body.projectKey);
});

test('aggregated case updates evidence counts timestamps and linked submissions', async () => {
  const api = createSignalForgeApi({ store: createStore(':memory:'), logger: { error() {}, warn() {} } });

  const firstSubmission = createSubmission({
    id: 'sub_first',
    submittedAt: '2026-05-21T00:00:00Z',
    source: 'web_widget',
    reporter: { id: 'user_1' },
    appContext: { route: '/reader/save', feature: 'save_flow', release: '1.0.0' },
    content: { title: 'Save freezes', body: 'When I click save, the page hangs and returns 500.' },
    evidence: { runtimeErrors: [{ message: 'timeout', fingerprint: 'save-timeout' }] },
  });
  const secondSubmission = createSubmission({
    id: 'sub_second',
    submittedAt: '2026-05-22T00:00:00Z',
    source: 'web_widget',
    reporter: { id: 'user_1' },
    appContext: { route: '/reader/save', feature: 'save_flow', release: '1.0.0' },
    content: { title: 'Save still freezes', body: 'Saving still hangs and throws a 500 error.' },
    evidence: { runtimeErrors: [{ message: 'timeout', fingerprint: 'save-timeout' }] },
  });

  api.store.saveSubmission(firstSubmission);
  api.store.saveSubmission(secondSubmission);

  await api.handleRequest({ method: 'POST', url: '/triage/run', body: { submissionIds: ['sub_first', 'sub_second'] } });
  const caseRecord = api.store.listCases()[0];

  assert.equal(caseRecord.evidenceSummary.submissionCount, 2);
  assert.equal(caseRecord.evidenceSummary.uniqueReporterCount, 1);
  assert.equal(caseRecord.evidenceSummary.firstSeenAt, '2026-05-21T00:00:00Z');
  assert.equal(caseRecord.evidenceSummary.latestSeenAt, '2026-05-22T00:00:00Z');
  assert.deepEqual(caseRecord.links.submissionIds.sort(), ['sub_first', 'sub_second']);
  assert.match(caseRecord.canonicalSummary, /Observed across 2 linked feedback submissions/);
});

test('hold_and_watch case stays unpublished', async () => {
  const api = createSignalForgeApi({ store: createStore(':memory:'), logger: { error() {}, warn() {} } });

  const caseRecord = await createSubmittedCase(api, {
    source: 'web_widget',
    reporter: { id: 'feature_user' },
    appContext: { route: '/reader/export', feature: 'export_menu', release: '1.0.0' },
    content: { title: 'Please add export support', body: 'Please add export to markdown and txt.' },
  });

  assert.equal(caseRecord.publishPolicyOutcome, 'hold_and_watch');
  assert.equal(caseRecord.publication.published, false);
  assert.equal(caseRecord.publication.target, 'github_issue');
});

test('already-published case can ingest more submissions without republishing', async () => {
  let publishCount = 0;
  const githubPublisher = {
    async publishCase({ caseRecord, repo, mode }) {
      publishCount += 1;
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
          externalId: `gh_issue_${publishCount}`,
          url: `https://github.com/${repo}/issues/${publishCount}`,
          number: publishCount,
        },
      };
    },
  };

  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    githubPublisher,
  });

  const firstCase = await createSubmittedCase(api, {
    source: 'web_widget',
    reporter: { id: 'user_1' },
    appContext: { route: '/reader/save', feature: 'save_flow', release: '1.0.0' },
    content: { title: 'Save freezes', body: 'Save freezes and returns 500.' },
    evidence: { runtimeErrors: [{ message: 'timeout', fingerprint: 'save-timeout' }] },
  });
  assert.equal(firstCase.publication.published, true);
  assert.equal(publishCount, 1);

  await createSubmittedCase(api, {
    source: 'web_widget',
    reporter: { id: 'user_2' },
    appContext: { route: '/reader/save', feature: 'save_flow', release: '1.0.1' },
    content: { title: 'Still freezing on save', body: 'The save action still hangs and returns 500.' },
    evidence: { runtimeErrors: [{ message: 'timeout', fingerprint: 'save-timeout' }] },
  });

  assert.equal(publishCount, 1);
  const cases = api.store.listCases();
  assert.equal(cases.length, 1);
  assert.equal(cases[0].evidenceSummary.submissionCount, 2);
});

test('api inbox exposes aggregation fields and supports filters', async () => {
  const api = createSignalForgeApi({ store: createStore(':memory:'), logger: { error() {}, warn() {} } });

  await createSubmittedCase(api, {
    source: 'web_widget',
    reporter: { id: 'user_1' },
    appContext: { route: '/reader/save', feature: 'save_flow', release: '1.0.0' },
    content: { title: 'Save freezes', body: 'Save freezes and returns 500.' },
    evidence: { runtimeErrors: [{ message: 'timeout', fingerprint: 'save-timeout' }] },
  });
  await createSubmittedCase(api, {
    source: 'web_widget',
    reporter: { id: 'user_2' },
    appContext: { route: '/reader/export', feature: 'export_menu', release: '1.0.0' },
    content: { title: 'Please add export support', body: 'Please add export support.' },
  });

  const publishedOnly = await api.handleRequest({ method: 'GET', url: '/cases?published=true', body: {} });
  assert.equal(publishedOnly.statusCode, 200);
  assert.equal(publishedOnly.body.items.length, 1);
  assert.equal(publishedOnly.body.items[0].publication.published, true);
  assert.ok('submissionCount' in publishedOnly.body.items[0]);
  assert.ok('uniqueReporterCount' in publishedOnly.body.items[0]);
  assert.ok('publishPolicyOutcome' in publishedOnly.body.items[0]);

  const heldOnly = await api.handleRequest({ method: 'GET', url: '/cases?published=false&status=ready_for_publish', body: {} });
  assert.equal(heldOnly.body.items.length, 1);
  assert.equal(heldOnly.body.items[0].publishPolicyOutcome, 'hold_and_watch');
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
  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    githubPublisher,
  });

  const caseRecord = await createSubmittedCase(api, {
    source: 'web_widget',
    reporter: { id: 'feature_user' },
    appContext: { route: '/reader/export', feature: 'export_menu', release: '1.0.0' },
    content: { title: 'Please add export support', body: 'I would like export support.' },
  });

  const publishResponse = await api.handleRequest({
    method: 'POST',
    url: `/cases/${caseRecord.id}/publish`,
    body: { target: { repo: 'uDeserve/FeedbackMesh', mode: 'github_issue' } },
  });

  assert.equal(publishResponse.statusCode, 201);
  assert.equal(publishResponse.body.result.externalId, 'gh_issue_123');
  assert.equal(publishResponse.body.result.number, 99);
});

test('api publish is idempotent for an already-published case', async () => {
  let publishCount = 0;
  const githubPublisher = {
    async publishCase({ caseRecord, repo, mode }) {
      publishCount += 1;
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
          externalId: 'gh_issue_1',
          url: `https://github.com/${repo}/issues/1`,
          number: 1,
        },
      };
    },
  };
  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    githubPublisher,
  });

  const caseRecord = await createSubmittedCase(api, {
    source: 'web_widget',
    reporter: { id: 'bug_user' },
    appContext: { route: '/reader/save', feature: 'save_flow', release: '1.0.0' },
    content: { title: 'Save freezes', body: 'Save freezes and returns 500.' },
    evidence: { runtimeErrors: [{ message: 'timeout', fingerprint: 'save-timeout' }] },
  });

  assert.equal(caseRecord.publication.published, true);
  assert.equal(publishCount, 1);

  const publishResponse = await api.handleRequest({
    method: 'POST',
    url: `/cases/${caseRecord.id}/publish`,
    body: { target: { repo: 'uDeserve/FeedbackMesh', mode: 'github_issue' } },
  });

  assert.equal(publishResponse.statusCode, 200);
  assert.equal(publishResponse.body.alreadyPublished, true);
  assert.equal(publishResponse.body.result.externalId, 'gh_issue_1');
  assert.equal(publishCount, 1);
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
    repo: 'uDeserve/FeedbackMesh',
    mode: 'github_issue',
  });
  assert.equal(published.repo, 'uDeserve/FeedbackMesh');
  assert.equal(published.result.number, 1);
  assert.match(published.result.url, /github\.com\/uDeserve\/FeedbackMesh\/issues\/1/);
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
            html_url: 'https://github.com/uDeserve/FeedbackMesh/issues/7',
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
    repo: 'uDeserve/FeedbackMesh',
    mode: 'github_issue',
  });

  assert.equal(request.url, 'https://api.github.test/repos/uDeserve/FeedbackMesh/issues');
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
            html_url: 'https://github.com/uDeserve/FeedbackMesh/issues/11',
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
    repo: 'uDeserve/FeedbackMesh',
    mode: 'github_issue',
  });

  assert.equal(request.url, 'https://api.github.test/repos/uDeserve/FeedbackMesh/issues');
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

test('github app installation lookup can discover installation by repo', async () => {
  const { privateKey } = await import('node:crypto').then(({ generateKeyPairSync }) =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }),
  );

  let request;
  const installation = await getGitHubAppInstallationForRepo({
    appId: '123456',
    privateKeyPem: privateKey,
    repo: 'uDeserve/signalforge-e2e-lab',
    apiBaseUrl: 'https://api.github.test',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        async json() {
          return {
            id: 999,
            app_id: 123456,
            app_slug: 'signalforge',
            repository_selection: 'selected',
            permissions: { issues: 'write', metadata: 'read' },
            events: ['issues', 'issue_comment'],
            account: { login: 'uDeserve', type: 'Organization' },
          };
        },
      };
    },
  });

  assert.equal(request.url, 'https://api.github.test/repos/uDeserve/signalforge-e2e-lab/installation');
  assert.equal(request.init.method, 'GET');
  assert.equal(installation.installationId, '999');
  assert.equal(installation.repo, 'uDeserve/signalforge-e2e-lab');
  assert.equal(installation.hasRequiredPermissions, true);
  assert.equal(installation.hasRequiredEvents, true);
});

test('repo-aware jwt installation token provider can auto-discover installation id from repo', async () => {
  const { privateKey } = await import('node:crypto').then(({ generateKeyPairSync }) =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }),
  );

  const requests = [];
  const provider = createRepoAwareJwtGitHubAppInstallationTokenProvider({
    appId: '123456',
    privateKeyPem: privateKey,
    apiBaseUrl: 'https://api.github.test',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/repos/uDeserve/signalforge-e2e-lab/installation')) {
        return {
          ok: true,
          async json() {
            return {
              id: 999,
              app_id: 123456,
              repository_selection: 'selected',
              permissions: { issues: 'write', metadata: 'read' },
              events: ['issues', 'issue_comment'],
              account: { login: 'uDeserve', type: 'Organization' },
            };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            token: 'installation_token_from_auto_discovery',
            expires_at: '2026-05-28T12:00:00Z',
          };
        },
      };
    },
  });

  const installation = await provider.getInstallationToken({ repo: 'uDeserve/signalforge-e2e-lab' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://api.github.test/repos/uDeserve/signalforge-e2e-lab/installation');
  assert.equal(requests[1].url, 'https://api.github.test/app/installations/999/access_tokens');
  assert.equal(installation.token, 'installation_token_from_auto_discovery');
  assert.equal(installation.installationId, '999');
});

test('github publisher from env prefers jwt app provider when full app credentials are present', () => {
  const publisher = createGitHubPublisherFromEnv({
    GITHUB_PUBLISHER: 'app',
    GITHUB_APP_ID: '123456',
    GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----',
    GITHUB_API_BASE_URL: 'https://api.github.test',
  });

  assert.equal(publisher.kind, 'app');
});

test('api rejects publication for non-actionable cases', async () => {
  const api = createSignalForgeApi({ store: createStore(':memory:'), logger: { error() {}, warn() {} } });

  const caseRecord = await createSubmittedCase(api, {
    source: 'web_widget',
    content: { body: 'hello' },
  });

  const publishResponse = await api.handleRequest({
    method: 'POST',
    url: `/cases/${caseRecord.id}/publish`,
    body: { target: { repo: 'uDeserve/FeedbackMesh', mode: 'github_issue' } },
  });
  assert.equal(publishResponse.statusCode, 422);
});

test('api creates delegation and returns case context', async () => {
  const api = createSignalForgeApi({ store: createStore(':memory:'), logger: { error() {}, warn() {} } });

  const caseRecord = await createSubmittedCase(api, {
    source: 'web_widget',
    content: { title: 'Save freezes', body: 'The page hangs on save and returns 500.' },
    evidence: { runtimeErrors: [{ message: 'timeout' }] },
  });

  const delegationResponse = await api.handleRequest({
    method: 'POST',
    url: '/delegations',
    body: {
      caseId: caseRecord.id,
      kind: 'skill',
      target: { type: 'skill', name: 'hermes' },
      request: { reason: 'owner_requested', context: { source: 'test' } },
    },
  });
  assert.equal(delegationResponse.statusCode, 201);

  const delegationList = await api.handleRequest({ method: 'GET', url: `/cases/${caseRecord.id}/delegations`, body: {} });
  assert.equal(delegationList.statusCode, 200);
  assert.equal(delegationList.body.items.length, 1);

  const contextResponse = await api.handleRequest({ method: 'GET', url: `/cases/${caseRecord.id}/context`, body: {} });
  assert.equal(contextResponse.statusCode, 200);
  assert.equal(contextResponse.body.case.id, caseRecord.id);
  assert.equal(contextResponse.body.delegations.length, 1);
  assert.equal(contextResponse.body.case.status, 'delegated');
});

test('api ingests runtime events and enriches case context', async () => {
  const api = createSignalForgeApi({ store: createStore(':memory:'), logger: { error() {}, warn() {} } });

  const firstEvent = await api.handleRequest({
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

  const secondEvent = await api.handleRequest({
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

  const contextResponse = await api.handleRequest({ method: 'GET', url: `/cases/${caseId}/context`, body: {} });
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
      cluster_signals: { route: '/reader/:id', feature: 'reader_lookup' },
      publish_recommendation: 'publish',
      confidence: 0.78,
      open_questions: ['Does this happen on every small screen?'],
      suggested_labels: ['type:ux', 'cluster:multi-user'],
      suggested_next_action: 'investigate',
    }),
  });
  const api = createSignalForgeApi({
    store: createStore(':memory:'),
    logger: { error() {}, warn() {} },
    triageEngine,
  });

  const caseRecord = await createSubmittedCase(api, {
    source: 'web_widget',
    content: {
      title: '手机点词后挡住正文',
      body: '点词后弹层挡住阅读内容，没法顺着往下看。',
    },
  });

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
                cluster_signals: { route: '/reader/:id' },
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
