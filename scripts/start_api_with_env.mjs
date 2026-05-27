import fs from 'node:fs';
import { createSignalForgeApi } from '../apps/api/src/index.js';
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

const port = Number(process.env.PORT || 8787);
const triageEngine = process.env.DEEPSEEK_API_KEY
  ? createTriageEngine({
      logger: console,
      submissionAnalyzer: createDeepSeekSubmissionAnalyzer({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      }),
    })
  : createTriageEngine({ logger: console });
const githubPublisher = createGitHubPublisherFromEnv(process.env);
const { server } = createSignalForgeApi({ triageEngine, logger: console, githubPublisher });

server.listen(port, () => {
  console.log(`SignalForge API listening on http://127.0.0.1:${port}`);
  console.log(
    `SignalForge triage mode: ${process.env.DEEPSEEK_API_KEY ? process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash' : 'heuristic fallback'}`
  );
  console.log(`SignalForge GitHub publisher: ${githubPublisher.kind}`);
});
