import fs from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = resolve(process.cwd());
const envExamplePath = resolve(
  process.env.SIGNALFORGE_ENV_EXAMPLE_FILE || resolve(repoRoot, '.env.example'),
);
const envPath = resolve(
  process.env.SIGNALFORGE_ENV_FILE || resolve(repoRoot, '.env'),
);

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

function printUsage() {
  console.log(`SignalForge CLI

Usage:
  node scripts/signalforge_cli.mjs init
  node scripts/signalforge_cli.mjs doctor
  node scripts/signalforge_cli.mjs integration
  node scripts/signalforge_cli.mjs manifest
  node scripts/signalforge_cli.mjs scaffold <template>
  node scripts/signalforge_cli.mjs start

Commands:
  init    Create a local .env from .env.example when missing.
  doctor  Check whether this repo is ready for a small-team trial setup.
  integration Print a machine-readable web-app integration contract.
  manifest Print a machine-readable setup contract for agents and automation.
  scaffold Emit or write an integration scaffold from the built-in agent templates.
  start   Start the SignalForge API through the repo startup script.
`);
}

function ensureEnvFile() {
  if (fs.existsSync(envPath)) {
    return {
      changed: false,
      path: envPath,
      message: '.env already exists.',
    };
  }

  const example = fs.readFileSync(envExamplePath, 'utf8');
  fs.writeFileSync(envPath, example, 'utf8');
  return {
    changed: true,
    path: envPath,
    message: 'Created .env from .env.example.',
  };
}

function checkField(env, key) {
  return Boolean(String(env[key] ?? '').trim());
}

function readString(env, key, fallback = '') {
  return String(env[key] ?? fallback).trim();
}

function hasFile(filePath) {
  return fs.existsSync(filePath);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = [...argv];
  const positional = [];
  let json = false;
  let outputDir = '';

  while (args.length) {
    const arg = args.shift();
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--output') {
      outputDir = String(args.shift() ?? '').trim();
      continue;
    }
    positional.push(arg);
  }

  const command = positional.shift() ?? 'help';
  return {
    command,
    json,
    outputDir,
    positional,
  };
}

async function canCreateGitHubPublisher(env) {
  try {
    const mod = await import('../packages/github-bridge/src/index.js');
    mod.createGitHubPublisherFromEnv(env);
    return true;
  } catch {
    return false;
  }
}

async function evaluateDoctor(env) {
  const checks = [];
  const publisherMode = String(env.GITHUB_PUBLISHER ?? 'preview').trim().toLowerCase() || 'preview';
  const dbPath = String(env.SIGNALFORGE_DB_PATH ?? '').trim();
  const hasDeepSeek = checkField(env, 'DEEPSEEK_API_KEY');
  const hasPat = checkField(env, 'GITHUB_TOKEN');
  const hasStaticAppToken = checkField(env, 'GITHUB_APP_INSTALLATION_TOKEN');
  const hasJwtAppInputs =
    checkField(env, 'GITHUB_APP_ID') &&
    checkField(env, 'GITHUB_APP_INSTALLATION_ID') &&
    checkField(env, 'GITHUB_APP_PRIVATE_KEY');
  const e2eRepo = readString(env, 'SIGNALFORGE_E2E_REPO');
  const webhookSecret = readString(env, 'GITHUB_WEBHOOK_SECRET');
  const hasGitHubAppE2E = hasFile(resolve(repoRoot, 'scripts', 'run_github_app_publish_e2e.mjs'));
  const hasGitHubPatE2E = hasFile(resolve(repoRoot, 'scripts', 'run_github_issue_publish_e2e.mjs'));
  const hasReaderappSample = hasFile(resolve(repoRoot, 'scripts', 'run_readerapp_feedback_sample.mjs'));

  checks.push({
    id: 'env-file',
    ok: fs.existsSync(envPath),
    level: 'required',
    summary: '.env file present',
    fix: 'Run `node scripts/signalforge_cli.mjs init`.',
  });

  checks.push({
    id: 'db-path',
    ok: true,
    level: 'info',
    summary: dbPath ? `Database path set: ${dbPath}` : 'Database path will use the default local data path',
    fix: '',
  });

  checks.push({
    id: 'publisher-mode',
    ok: ['preview', 'pat', 'app'].includes(publisherMode),
    level: 'required',
    summary: `GitHub publisher mode: ${publisherMode}`,
    fix: 'Set GITHUB_PUBLISHER to preview, pat, or app.',
  });

  checks.push({
    id: 'deepseek',
    ok: true,
    level: 'optional',
    summary: hasDeepSeek ? 'DeepSeek triage is configured' : 'DeepSeek triage is not configured; heuristic fallback will be used',
    fix: 'Set DEEPSEEK_API_KEY to enable LLM-assisted triage.',
  });

  checks.push({
    id: 'readerapp-sample',
    ok: hasReaderappSample,
    level: 'info',
    summary: hasReaderappSample
      ? 'Reader app sample script is available for local intake validation'
      : 'Reader app sample script is missing',
    fix: 'Restore scripts/run_readerapp_feedback_sample.mjs for local intake validation.',
  });

  if (publisherMode === 'preview') {
    checks.push({
      id: 'preview-ready',
      ok: true,
      level: 'required',
      summary: 'Preview publisher requires no GitHub auth and is ready for local flow validation',
      fix: '',
    });
  }

  if (publisherMode === 'pat') {
    checks.push({
      id: 'github-token',
      ok: hasPat,
      level: 'required',
      summary: hasPat ? 'PAT publisher token configured' : 'PAT publisher token missing',
      fix: 'Set GITHUB_TOKEN for PAT-backed GitHub issue creation.',
    });

    checks.push({
      id: 'pat-e2e-script',
      ok: hasGitHubPatE2E,
      level: 'info',
      summary: hasGitHubPatE2E
        ? 'PAT issue publish validation script is available'
        : 'PAT issue publish validation script is missing',
      fix: 'Restore scripts/run_github_issue_publish_e2e.mjs.',
    });

    checks.push({
      id: 'e2e-repo',
      ok: Boolean(e2eRepo),
      level: 'recommended',
      summary: e2eRepo
        ? `E2E repository configured: ${e2eRepo}`
        : 'E2E repository not configured; default lab repo will be used',
      fix: 'Set SIGNALFORGE_E2E_REPO to the repository where SignalForge should create validation issues.',
    });
  }

  if (publisherMode === 'app') {
    checks.push({
      id: 'github-app-auth',
      ok: hasStaticAppToken || hasJwtAppInputs,
      level: 'required',
      summary:
        hasJwtAppInputs
          ? 'GitHub App JWT flow configured'
          : hasStaticAppToken
            ? 'GitHub App static installation token configured'
            : 'GitHub App auth is incomplete',
      fix:
        'Set either GITHUB_APP_INSTALLATION_TOKEN or the full GITHUB_APP_ID + GITHUB_APP_INSTALLATION_ID + GITHUB_APP_PRIVATE_KEY set.',
    });

    checks.push({
      id: 'github-app-installation-id',
      ok: checkField(env, 'GITHUB_APP_INSTALLATION_ID'),
      level: 'required',
      summary: checkField(env, 'GITHUB_APP_INSTALLATION_ID')
        ? 'GitHub App installation id present'
        : 'GitHub App installation id missing',
      fix: 'Set GITHUB_APP_INSTALLATION_ID after installing the app into the target repository.',
    });

    checks.push({
      id: 'github-app-e2e-script',
      ok: hasGitHubAppE2E,
      level: 'info',
      summary: hasGitHubAppE2E
        ? 'GitHub App publish validation script is available'
        : 'GitHub App publish validation script is missing',
      fix: 'Restore scripts/run_github_app_publish_e2e.mjs.',
    });

    checks.push({
      id: 'github-app-e2e-repo',
      ok: Boolean(e2eRepo),
      level: 'recommended',
      summary: e2eRepo
        ? `GitHub App E2E repository configured: ${e2eRepo}`
        : 'GitHub App E2E repository is not configured; default lab repo will be used',
      fix: 'Set SIGNALFORGE_E2E_REPO to the repository where the bot should publish validation issues.',
    });

    checks.push({
      id: 'github-webhook-secret',
      ok: Boolean(webhookSecret),
      level: 'recommended',
      summary: webhookSecret
        ? 'GitHub webhook secret is configured for comment decision sync'
        : 'GitHub webhook secret is not configured; comment decision sync is not production-ready',
      fix: 'Set GITHUB_WEBHOOK_SECRET and use the same secret in the GitHub App webhook settings.',
    });
  }

  const existingWebAppTrialReady =
    checks.find((item) => item.id === 'env-file')?.ok &&
    checks.find((item) => item.id === 'publisher-mode')?.ok;

  const githubAppTrialReady =
    publisherMode === 'app' &&
    checks.find((item) => item.id === 'github-app-auth')?.ok &&
    checks.find((item) => item.id === 'github-app-installation-id')?.ok;

  const canCreatePublisher = await canCreateGitHubPublisher(env);

  return {
    schemaVersion: 1,
    publisherMode,
    canCreatePublisher,
    existingWebAppTrialReady: Boolean(existingWebAppTrialReady),
    githubAppTrialReady: Boolean(githubAppTrialReady),
    e2eRepo: e2eRepo || 'uDeserve/signalforge-e2e-lab',
    webhookSecretConfigured: Boolean(webhookSecret),
    checks,
  };
}

function printDoctor(result) {
  console.log('SignalForge Doctor');
  console.log('');
  console.log(`Publisher mode: ${result.publisherMode}`);
  console.log(`Existing web app trial ready: ${result.existingWebAppTrialReady ? 'yes' : 'no'}`);
  console.log(`GitHub App trial ready: ${result.githubAppTrialReady ? 'yes' : 'no'}`);
  console.log(`Publisher object creatable: ${result.canCreatePublisher ? 'yes' : 'no'}`);
  if (result.publisherMode === 'pat' || result.publisherMode === 'app') {
    console.log(`E2E repository: ${result.e2eRepo}`);
  }
  if (result.publisherMode === 'app') {
    console.log(`Webhook secret configured: ${result.webhookSecretConfigured ? 'yes' : 'no'}`);
  }
  console.log('');

  for (const check of result.checks) {
    console.log(`${check.ok ? 'OK' : 'MISSING'} [${check.level}] ${check.summary}`);
    if (!check.ok && check.fix) {
      console.log(`  fix: ${check.fix}`);
    }
  }

  console.log('');
  console.log('Recommended next step:');
  if (!result.existingWebAppTrialReady) {
    console.log('- Run `node scripts/signalforge_cli.mjs init` and fill the required .env values.');
    return;
  }
  if (result.publisherMode === 'preview') {
    console.log('- Run `node scripts/signalforge_cli.mjs start` for local validation, then `node scripts/run_readerapp_feedback_sample.mjs`.');
    return;
  }
  if (result.publisherMode === 'app' && !result.githubAppTrialReady) {
    console.log('- Finish GitHub App env setup, then run `node scripts/run_github_app_publish_e2e.mjs`.');
    return;
  }
  if (result.publisherMode === 'app' && !result.webhookSecretConfigured) {
    console.log('- GitHub App publish can be validated now, but webhook-based decision sync is still incomplete until GITHUB_WEBHOOK_SECRET is set.');
    return;
  }
  if (result.publisherMode === 'pat' && !result.canCreatePublisher) {
    console.log('- Set the PAT env correctly, then run `node scripts/run_github_issue_publish_e2e.mjs`.');
    return;
  }
  if (result.publisherMode === 'app') {
    console.log('- Run `node scripts/run_github_app_publish_e2e.mjs` to validate the bot workflow.');
    return;
  }
  if (result.publisherMode === 'pat') {
    console.log('- Run `node scripts/run_github_issue_publish_e2e.mjs` to validate issue publication.');
  }
}

function buildManifest() {
  return {
    schemaVersion: 1,
    product: 'SignalForge',
    repoType: 'monorepo',
    audience: ['small_web_team', 'indie_developer', 'coding_agent'],
    goals: [
      'connect to an existing web app quickly',
      'aggregate noisy feedback into cases',
      'publish issues through GitHub or a GitHub App',
      'keep maintainer decisions inside GitHub',
    ],
    installModes: [
      {
        id: 'repo_local_preview',
        purpose: 'fastest local validation path',
        commands: [
          'npm run sf:init',
          'npm run sf:doctor',
          'npm run sf:start',
          'node scripts/run_readerapp_feedback_sample.mjs',
        ],
        requiredEnv: ['GITHUB_PUBLISHER'],
        defaults: {
          GITHUB_PUBLISHER: 'preview',
        },
      },
      {
        id: 'github_app_trial',
        purpose: 'bot-style GitHub workflow validation',
        commands: [
          'npm run sf:doctor',
          'node scripts/run_github_app_publish_e2e.mjs',
        ],
        requiredEnv: [
          'GITHUB_PUBLISHER',
          'GITHUB_APP_INSTALLATION_ID',
        ],
        oneOfEnvSets: [
          ['GITHUB_APP_INSTALLATION_TOKEN'],
          ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_INSTALLATION_ID'],
        ],
        recommendedEnv: [
          'SIGNALFORGE_E2E_REPO',
          'GITHUB_WEBHOOK_SECRET',
        ],
        defaults: {
          GITHUB_PUBLISHER: 'app',
          SIGNALFORGE_E2E_REPO: 'uDeserve/signalforge-e2e-lab',
        },
      },
    ],
    frontendIntegration: {
      recommendedExport: 'installSignalForgePreset',
      package: '@signalforge/adapter',
      minimalExample: {
        import: "import { installSignalForgePreset } from '@signalforge/adapter';",
        code: [
          "installSignalForgePreset({",
          "  endpoint: 'https://signalforge.example.com',",
          "  projectKey: 'proj_readerapp',",
          "  appName: 'readerapp',",
          "  environment: 'production',",
          "  release: '1.2.3',",
          "});",
        ].join('\n'),
      },
      requiredDomSelector: '#sf-feedback-root',
    },
    verification: {
      localPreview: 'node scripts/run_readerapp_feedback_sample.mjs',
      githubPat: 'node scripts/run_github_issue_publish_e2e.mjs',
      githubApp: 'node scripts/run_github_app_publish_e2e.mjs',
    },
    docs: {
      quickStart: 'docs/quick-start.md',
      githubAppSetup: 'docs/github-app-setup.md',
      architecture: 'docs/architecture.md',
      apiContract: 'docs/api-contract.md',
    },
  };
}

function buildIntegrationSpec() {
  return readJsonFile(resolve(repoRoot, 'signalforge.integration.json'));
}

function buildScaffoldTemplates() {
  return {
    'browser-preset': {
      id: 'browser-preset',
      description: 'Minimal browser shell with SignalForge preset wiring.',
      baseDir: resolve(repoRoot, 'examples', 'agent', 'browser-preset'),
      files: ['index.html', 'main.js'],
    },
    'react-preset': {
      id: 'react-preset',
      description: 'Minimal React shell and client entry with SignalForge preset wiring.',
      baseDir: resolve(repoRoot, 'examples', 'agent', 'react-preset'),
      files: ['AppShell.jsx', 'client-entry.jsx'],
    },
  };
}

function buildScaffoldResult(templateId) {
  const templates = buildScaffoldTemplates();
  const template = templates[templateId];
  if (!template) {
    const supported = Object.keys(templates).sort();
    throw new Error(`unknown scaffold template: ${templateId}. Supported: ${supported.join(', ')}`);
  }

  return {
    schemaVersion: 1,
    product: 'SignalForge',
    templateId: template.id,
    description: template.description,
    files: template.files.map((file) => ({
      path: file,
      content: fs.readFileSync(resolve(template.baseDir, file), 'utf8'),
    })),
  };
}

function writeScaffoldResult(result, outputDir) {
  const targetRoot = resolve(outputDir);
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const file of result.files) {
    const destination = resolve(targetRoot, file.path);
    fs.mkdirSync(resolve(destination, '..'), { recursive: true });
    fs.writeFileSync(destination, file.content, 'utf8');
  }
  return {
    outputDir: targetRoot,
    writtenFiles: result.files.map((file) => resolve(targetRoot, file.path)),
  };
}

function runStart() {
  const child = spawn(process.execPath, [resolve(repoRoot, 'scripts', 'start_api_with_env.mjs')], {
    stdio: 'inherit',
    env: process.env,
    cwd: repoRoot,
  });
  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

async function main() {
  const { command, json, outputDir, positional } = parseArgs();
  if (command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return;
  }
  if (command === 'init') {
    const result = ensureEnvFile();
    if (json) {
      console.log(JSON.stringify({
        schemaVersion: 1,
        command: 'init',
        ...result,
      }, null, 2));
      return;
    }
    console.log(result.message);
    console.log(`Path: ${result.path}`);
    console.log('Next: fill the GitHub and optional DeepSeek values, then run `node scripts/signalforge_cli.mjs doctor`.');
    return;
  }
  if (command === 'doctor') {
    const env = mergeEnv(loadEnv(envExamplePath), loadEnv(envPath), process.env);
    const result = await evaluateDoctor(env);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printDoctor(result);
    return;
  }
  if (command === 'manifest') {
    const result = buildManifest();
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'integration') {
    const result = buildIntegrationSpec();
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'scaffold') {
    const templateId = positional[0] ?? 'browser-preset';
    const result = buildScaffoldResult(templateId);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (outputDir) {
      const writeResult = writeScaffoldResult(result, outputDir);
      console.log(`Wrote SignalForge scaffold '${templateId}' to ${writeResult.outputDir}`);
      for (const file of writeResult.writtenFiles) {
        console.log(`- ${file}`);
      }
      return;
    }
    console.log(`SignalForge scaffold '${templateId}' is available.`);
    console.log('Use `--json` for machine-readable output or `--output <dir>` to write files.');
    return;
  }
  if (command === 'start') {
    runStart();
    return;
  }

  printUsage();
  process.exitCode = 1;
}

await main();
