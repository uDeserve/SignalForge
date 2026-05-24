import fs from 'node:fs';
import { createSignalForgeApi } from '../apps/api/src/index.js';
import { createTriageEngine } from '../packages/triage/src/index.js';
import { createDeepSeekSubmissionAnalyzer } from '../packages/triage/src/deepseek.js';
import { createStore } from '../apps/api/src/store.js';

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

const { handleRequest, store } = createSignalForgeApi({
  store: createStore(':memory:'),
  logger: console,
  triageEngine,
});

const submissionResponse = await handleRequest({
  method: 'POST',
  url: '/submissions',
  body: {
    source: 'omni_lingua_web',
    reporter: {
      id: 'user_demo_1',
    },
    appContext: {
      appName: 'readerapp',
      environment: 'production',
      release: '1.0.0',
      route: '/reader/book-1/chapter-3',
      bookId: 'book_1',
      bookTitle: 'Animal Farm',
      chapterId: 'chapter_3',
      chapterTitle: 'Chapter 3',
      chapterIndex: 2,
      sourceType: 'user_upload',
      feedbackType: 'reader',
      rating: 'bad',
      reasons: ['手机端体验不好', '布局不舒服'],
      view: 'reader',
      action: 'submit_reader_feedback',
      feature: 'reader_feedback',
    },
    content: {
      title: '手机点词后挡住正文',
      body: '点词后弹层挡住阅读内容，没法顺着往下看，手机上特别难受。',
      categoryHint: 'feedback',
      rating: 'bad',
      sentimentHint: 'negative',
      language: 'zh-CN',
    },
    evidence: {
      feedbackReasons: ['手机端体验不好', '布局不舒服'],
      hasComment: true,
    },
    privacy: {
      containsPii: false,
      redactionStatus: 'pending',
    },
    raw: {
      feedbackType: 'reader',
      source: 'readerapp_signalforge_bridge',
    },
  },
});

const submissionId = submissionResponse.body.submissionId;
const triageResponse = await handleRequest({
  method: 'POST',
  url: '/triage/run',
  body: {
    submissionIds: [submissionId],
  },
});

const casesResponse = await handleRequest({
  method: 'GET',
  url: '/cases',
  body: {},
});

console.log(JSON.stringify({
  submission: submissionResponse.body,
  triage: triageResponse.body,
  case: casesResponse.body.items[0],
}, null, 2));

store.close();
