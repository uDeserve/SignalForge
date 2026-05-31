import fs from 'node:fs';
import { createSignalForgeApi } from '../apps/api/src/index.js';
import { createStore } from '../apps/api/src/store.js';
import { createTriageEngine } from '../packages/triage/src/index.js';
import { createDeepSeekSubmissionAnalyzer } from '../packages/triage/src/deepseek.js';
import { createGitHubPublisherFromEnv } from '../packages/github-bridge/src/index.js';

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    process.env[key] = value;
  }
}

loadEnv(new URL('../.env', import.meta.url));

const targetRepo = process.env.SIGNALFORGE_E2E_REPO || 'uDeserve/signalforge-e2e-lab';
const analyzer = process.env.DEEPSEEK_API_KEY
  ? createDeepSeekSubmissionAnalyzer({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    })
  : null;

const triageEngine = createTriageEngine({
  logger: console,
  submissionAnalyzer: analyzer ?? undefined,
});

const githubPublisher = createGitHubPublisherFromEnv(process.env);
const { handleRequest, store } = createSignalForgeApi({
  store: createStore(':memory:'),
  logger: console,
  triageEngine,
  githubPublisher,
});

const submissionResponse = await handleRequest({
  method: 'POST',
  url: '/submissions',
  body: {
    source: 'omni_lingua_web',
    reporter: {
      id: 'signalforge_e2e_user',
    },
    appContext: {
      appName: 'readerapp',
      environment: 'staging',
      release: 'signalforge-e2e',
      route: '/reader/e2e',
      feature: 'signalforge_publish_test',
      action: 'submit_feedback',
      sourceType: 'user_upload',
      feedbackType: 'reader',
    },
    content: {
      title: '[SignalForge E2E Test] Reader feedback should become a real GitHub issue',
      body: 'This is a real SignalForge PAT publication test. The mobile reader popup blocks reading flow and should be published as a GitHub issue.',
      categoryHint: 'feedback',
      rating: 'bad',
      sentimentHint: 'negative',
      language: 'en',
    },
    evidence: {
      reproduction: 'Open reader, tap a word, popup blocks content.',
    },
    privacy: {
      containsPii: false,
      redactionStatus: 'pending',
    },
    raw: {
      source: 'signalforge_e2e_script',
    },
  },
});

const submissionId = submissionResponse.body.submissionId;
await handleRequest({
  method: 'POST',
  url: '/triage/run',
  body: { submissionIds: [submissionId] },
});

const casesResponse = await handleRequest({
  method: 'GET',
  url: '/cases',
  body: {},
});

const caseRecord = casesResponse.body.items[0];
const publishResponse = await handleRequest({
  method: 'POST',
  url: `/cases/${caseRecord.id}/publish`,
  body: {
    target: {
      repo: targetRepo,
      mode: 'github_issue',
      publicRepo: true,
    },
  },
});

if (publishResponse.error) {
  console.error(JSON.stringify({
    publisher: githubPublisher.kind,
    targetRepo,
    caseId: caseRecord.id,
    error: publishResponse.error,
  }, null, 2));
  store.close();
  process.exit(1);
}

console.log(JSON.stringify({
  publisher: githubPublisher.kind,
  publisherMode: process.env.GITHUB_PUBLISHER || 'preview',
  targetRepo,
  caseId: caseRecord.id,
  publishResult: publishResponse.body.result,
}, null, 2));

store.close();
