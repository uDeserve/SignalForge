import fs from 'node:fs';
import { basename, resolve } from 'node:path';

const repoRoot = resolve(process.cwd());
const cliInvocation = basename(process.argv[1] || 'signalforge_hosted_setup.mjs');
const feedbackMeshBrand =
  process.env.FEEDBACKMESH_BRAND === '1' || cliInvocation === 'feedbackmesh_hosted_setup.mjs';
const cliScriptPath = `scripts/${feedbackMeshBrand ? 'feedbackmesh_hosted_setup.mjs' : 'signalforge_hosted_setup.mjs'}`;
const envExamplePath = resolve(
  process.env.SIGNALFORGE_ENV_EXAMPLE_FILE || resolve(repoRoot, '.env.example'),
);
const envPath = resolve(
  process.env.SIGNALFORGE_ENV_FILE || resolve(repoRoot, '.env'),
);
const defaultBaseUrl = 'https://feedbackmesh.launchhub.icu';

function loadEnv(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    result[key] = value;
  }
  return result;
}

function mergeEnv(...sources) {
  return Object.assign({}, ...sources);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = [...argv];
  const positional = [];
  const flags = {};

  while (args.length) {
    const arg = args.shift();
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[0];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }
    flags[key] = args.shift();
  }

  return {
    command: positional.shift() ?? 'help',
    positional,
    flags,
  };
}

function parseRepo(value = '') {
  const text = String(value ?? '').trim().replace(/^https:\/\/github\.com\//i, '');
  const [owner = '', name = ''] = text.split('/').filter(Boolean);
  return {
    owner,
    name,
    fullName: owner && name ? `${owner}/${name}` : '',
  };
}

function resolveBaseUrl(flags, env) {
  return String(
    flags['base-url'] ||
      env.SIGNALFORGE_PUBLIC_BASE_URL ||
      env.FEEDBACKMESH_BASE_URL ||
      defaultBaseUrl,
  ).trim().replace(/\/+$/, '');
}

function printUsage() {
  console.log(`FeedbackMesh Hosted Setup Helper

Usage:
  node ${cliScriptPath} create --name "Omni Lingua" --app-name omni_lingua --repo owner/repo [--base-url ${defaultBaseUrl}]
  node ${cliScriptPath} status --session <sessionId> [--base-url ${defaultBaseUrl}]
  node ${cliScriptPath} contract --session <sessionId> [--base-url ${defaultBaseUrl}]
  node ${cliScriptPath} confirm-binding --session <sessionId> --repo owner/repo --binding-code <code> [--base-url ${defaultBaseUrl}]

Flags:
  --json       Print raw JSON only
  --actor-id   Optional actor id for create
  --actor-type Optional actor type for create, defaults to agent
`);
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const error = payload?.error ?? payload ?? { message: `request failed: ${response.status}` };
    const detail = {
      status: response.status,
      error,
    };
    throw new Error(JSON.stringify(detail, null, 2));
  }

  return payload.data ?? payload;
}

async function createSession({ baseUrl, flags }) {
  const name = String(flags.name ?? '').trim();
  const appName = String(flags['app-name'] ?? '').trim();
  const repo = parseRepo(flags.repo);

  if (!name || !appName || !repo.fullName) {
    throw new Error('create requires --name, --app-name, and --repo owner/repo');
  }

  return requestJson(`${baseUrl}/setup/sessions`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      appName,
      repo: {
        owner: repo.owner,
        name: repo.name,
      },
      actor: flags['actor-id']
        ? {
            type: String(flags['actor-type'] || 'agent'),
            id: String(flags['actor-id']),
          }
        : undefined,
    }),
  });
}

async function getSessionStatus({ baseUrl, flags }) {
  const sessionId = String(flags.session ?? '').trim();
  if (!sessionId) {
    throw new Error('status requires --session <sessionId>');
  }
  return requestJson(`${baseUrl}/setup/sessions/${sessionId}`);
}

async function getSessionContract({ baseUrl, flags }) {
  const sessionId = String(flags.session ?? '').trim();
  if (!sessionId) {
    throw new Error('contract requires --session <sessionId>');
  }
  return requestJson(`${baseUrl}/setup/sessions/${sessionId}/agent-contract`);
}

async function confirmBinding({ baseUrl, flags }) {
  const sessionId = String(flags.session ?? '').trim();
  const bindingCode = String(flags['binding-code'] ?? '').trim();
  const repo = parseRepo(flags.repo);

  if (!sessionId || !bindingCode || !repo.fullName) {
    throw new Error('confirm-binding requires --session, --binding-code, and --repo owner/repo');
  }

  return requestJson(`${baseUrl}/setup/sessions/${sessionId}/github-binding`, {
    method: 'POST',
    body: JSON.stringify({
      bindingCode,
      repo: repo.fullName,
    }),
  });
}

function printCreateSummary(result) {
  console.log('FeedbackMesh Hosted Setup Session Created');
  console.log('');
  console.log(`Session ID: ${result.id}`);
  console.log(`Project: ${result.project.name}`);
  console.log(`Repo: ${result.project.github.repo || '(not set)'}`);
  console.log(`Stage: ${result.state.currentStage}`);
  console.log(`Install URL: ${result.state.installUrl}`);
  console.log(`Binding code: ${result.state.binding.code}`);
  console.log('');
  console.log('Env patch:');
  console.log(`- VITE_SIGNALFORGE_ENDPOINT=${result.project.hosted.env.VITE_SIGNALFORGE_ENDPOINT}`);
  console.log(`- VITE_SIGNALFORGE_PROJECT_KEY=${result.project.hosted.env.VITE_SIGNALFORGE_PROJECT_KEY}`);
  console.log(`- VITE_SIGNALFORGE_APP_NAME=${result.project.hosted.env.VITE_SIGNALFORGE_APP_NAME}`);
  if (result.state.blockingHumanAction?.title) {
    console.log('');
    console.log(`Blocking human action: ${result.state.blockingHumanAction.title}`);
    console.log(result.state.blockingHumanAction.description);
  }
}

function printStatusSummary(result) {
  console.log('FeedbackMesh Hosted Setup Status');
  console.log('');
  console.log(`Session ID: ${result.id}`);
  console.log(`Stage: ${result.state.currentStage}`);
  console.log(`Repo: ${result.project.github.repo || '(not set)'}`);
  console.log(`Binding confirmed: ${result.state.binding.confirmed ? 'yes' : 'no'}`);
  console.log(`GitHub installed: ${result.state.stages.github_app_installed ? 'yes' : 'no'}`);
  console.log(`First submission seen: ${result.state.stages.first_submission_seen ? 'yes' : 'no'}`);
  console.log(`First case created: ${result.state.stages.first_case_created ? 'yes' : 'no'}`);
  console.log(`First issue published: ${result.state.stages.first_issue_published ? 'yes' : 'no'}`);
  if (result.state.blockingHumanAction?.title) {
    console.log('');
    console.log(`Blocking human action: ${result.state.blockingHumanAction.title}`);
    console.log(result.state.blockingHumanAction.description);
  }
}

function printContractSummary(result) {
  console.log('FeedbackMesh Hosted Agent Contract');
  console.log('');
  console.log(`Mode: ${result.mode}`);
  console.log(`Next agent action: ${result.instructions.nextAgentAction}`);
  console.log(`Project key: ${result.machineConfig.projectKey}`);
  console.log(`Status URL: ${result.api.statusUrl}`);
  console.log(`Binding code: ${result.binding.code}`);
  if (result.instructions.blockingHumanAction?.url) {
    console.log(`Blocking action URL: ${result.instructions.blockingHumanAction.url}`);
  }
}

async function main() {
  const { command, flags } = parseArgs();
  if (command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  const env = mergeEnv(loadEnv(envExamplePath), loadEnv(envPath), process.env);
  const baseUrl = resolveBaseUrl(flags, env);
  const json = Boolean(flags.json);

  let result;
  if (command === 'create') {
    result = await createSession({ baseUrl, flags });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printCreateSummary(result);
    return;
  }
  if (command === 'status') {
    result = await getSessionStatus({ baseUrl, flags });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printStatusSummary(result);
    return;
  }
  if (command === 'contract') {
    result = await getSessionContract({ baseUrl, flags });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printContractSummary(result);
    return;
  }
  if (command === 'confirm-binding') {
    result = await confirmBinding({ baseUrl, flags });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printStatusSummary(result);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

await main();
