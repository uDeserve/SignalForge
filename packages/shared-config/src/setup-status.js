import { resolve } from 'node:path';

export function checkField(env, key) {
  return Boolean(String(env[key] ?? '').trim());
}

export function readString(env, key, fallback = '') {
  return String(env[key] ?? fallback).trim();
}

export function hasFile(fileSystem, filePath) {
  return fileSystem.existsSync(filePath);
}

export async function canCreateGitHubPublisher(env) {
  try {
    const mod = await import('../../github-bridge/src/index.js');
    mod.createGitHubPublisherFromEnv(env);
    return true;
  } catch {
    return false;
  }
}

function buildSetupStages({
  publisherMode,
  checks,
  e2eRepo,
  webhookSecretConfigured,
}) {
  const byId = new Map(checks.map((check) => [check.id, check]));
  const hasEnvFile = Boolean(byId.get('env-file')?.ok);
  const hasPublisherMode = Boolean(byId.get('publisher-mode')?.ok);
  const hasGithubAppAuth = Boolean(byId.get('github-app-auth')?.ok);
  const hasGithubAppInstallationId = Boolean(byId.get('github-app-installation-id')?.ok);

  return {
    envFileReady: hasEnvFile,
    appConnected: hasEnvFile && hasPublisherMode,
    repoConnected: publisherMode === 'preview' ? true : Boolean(e2eRepo),
    githubAppInstalled: publisherMode === 'app' ? hasGithubAppInstallationId : false,
    authReady:
      publisherMode === 'preview'
        ? true
        : publisherMode === 'pat'
          ? Boolean(byId.get('github-token')?.ok)
          : hasGithubAppAuth,
    webhookReady: publisherMode === 'app' ? webhookSecretConfigured : false,
    publishTestReady:
      publisherMode === 'preview'
        ? hasEnvFile && hasPublisherMode
        : publisherMode === 'pat'
          ? Boolean(byId.get('github-token')?.ok)
          : hasGithubAppAuth && hasGithubAppInstallationId,
    decisionSyncReady: publisherMode === 'app' ? webhookSecretConfigured : false,
  };
}

export async function evaluateSetupStatus({
  env,
  repoRoot,
  fileSystem,
}) {
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
  const hasGitHubAppE2E = hasFile(fileSystem, resolve(repoRoot, 'scripts', 'run_github_app_publish_e2e.mjs'));
  const hasGitHubPatE2E = hasFile(fileSystem, resolve(repoRoot, 'scripts', 'run_github_issue_publish_e2e.mjs'));
  const hasReaderappSample = hasFile(fileSystem, resolve(repoRoot, 'scripts', 'run_readerapp_feedback_sample.mjs'));
  const envFilePath = readString(env, 'SIGNALFORGE_ENV_FILE', resolve(repoRoot, '.env'));

  checks.push({
    id: 'env-file',
    ok: fileSystem.existsSync(envFilePath),
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
  const webhookSecretConfigured = Boolean(webhookSecret);
  const setupStages = buildSetupStages({
    publisherMode,
    checks,
    e2eRepo: e2eRepo || 'uDeserve/signalforge-e2e-lab',
    webhookSecretConfigured,
  });

  return {
    schemaVersion: 2,
    publisherMode,
    canCreatePublisher,
    existingWebAppTrialReady: Boolean(existingWebAppTrialReady),
    githubAppTrialReady: Boolean(githubAppTrialReady),
    e2eRepo: e2eRepo || 'uDeserve/signalforge-e2e-lab',
    webhookSecretConfigured,
    setupStages,
    checks,
  };
}
