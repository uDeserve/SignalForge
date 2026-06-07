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

async function discoverGitHubAppConnection(env) {
  const repo = readString(env, 'SIGNALFORGE_E2E_REPO');
  const appId = readString(env, 'GITHUB_APP_ID');
  const privateKeyPem = readString(env, 'GITHUB_APP_PRIVATE_KEY');
  const installationId = readString(env, 'GITHUB_APP_INSTALLATION_ID');
  const apiBaseUrl = readString(env, 'GITHUB_API_BASE_URL', 'https://api.github.com');

  if (!appId || !privateKeyPem) {
    return {
      mode: 'unavailable',
      repo,
      discovered: false,
      installation: null,
      errors: [],
    };
  }

  try {
    const mod = await import('../../github-bridge/src/index.js');
    let installation = null;

    if (repo) {
      installation = await mod.getGitHubAppInstallationForRepo({
        appId,
        privateKeyPem,
        repo,
        apiBaseUrl,
      });
    } else if (installationId) {
      installation = await mod.getGitHubAppInstallationById({
        appId,
        privateKeyPem,
        installationId,
        apiBaseUrl,
      });
    }

    return {
      mode: repo ? 'repo_lookup' : installationId ? 'id_lookup' : 'auth_only',
      repo,
      discovered: Boolean(installation?.installationId),
      installation,
      errors: [],
    };
  } catch (error) {
    return {
      mode: repo ? 'repo_lookup' : installationId ? 'id_lookup' : 'auth_only',
      repo,
      discovered: false,
      installation: null,
      errors: [String(error?.message ?? error)],
    };
  }
}

function buildSetupStages({
  publisherMode,
  checks,
  e2eRepo,
  webhookSecretConfigured,
  connection,
}) {
  const byId = new Map(checks.map((check) => [check.id, check]));
  const hasEnvFile = Boolean(byId.get('env-file')?.ok);
  const hasPublisherMode = Boolean(byId.get('publisher-mode')?.ok);
  const hasGithubAppAuth = Boolean(byId.get('github-app-auth')?.ok);
  const hasGithubAppInstallationId =
    Boolean(byId.get('github-app-installation-id')?.ok) || Boolean(connection?.installation?.installationId);
  const hasRepoConnection = publisherMode === 'preview'
    ? true
    : Boolean(connection?.installation?.repo || e2eRepo);

  return {
    envFileReady: hasEnvFile,
    appConnected: hasEnvFile && hasPublisherMode,
    repoConnected: hasRepoConnection,
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
          : hasGithubAppAuth && hasGithubAppInstallationId && hasRepoConnection,
    decisionSyncReady:
      publisherMode === 'app'
        ? webhookSecretConfigured && Boolean(connection?.installation?.hasRequiredEvents)
        : false,
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
  const connection = publisherMode === 'app'
    ? await discoverGitHubAppConnection(env)
    : { mode: 'not_app', repo: e2eRepo, discovered: false, installation: null, errors: [] };

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
      ok: checkField(env, 'GITHUB_APP_INSTALLATION_ID') || Boolean(connection.installation?.installationId),
      level: 'required',
      summary: connection.installation?.installationId
        ? `GitHub App installation discovered: ${connection.installation.installationId}`
        : checkField(env, 'GITHUB_APP_INSTALLATION_ID')
          ? 'GitHub App installation id present'
          : 'GitHub App installation id missing',
      fix: repoRoot
        ? 'Install the GitHub App into the target repository or set GITHUB_APP_INSTALLATION_ID directly.'
        : 'Set GITHUB_APP_INSTALLATION_ID after installing the app into the target repository.',
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
      ok: Boolean(connection.installation?.repo || e2eRepo),
      level: 'recommended',
      summary: connection.installation?.repo
        ? `GitHub App connected repository discovered: ${connection.installation.repo}`
        : e2eRepo
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

    checks.push({
      id: 'github-app-installation-permissions',
      ok: Boolean(connection.installation?.hasRequiredPermissions),
      level: 'recommended',
      summary: connection.installation
        ? connection.installation.hasRequiredPermissions
          ? 'GitHub App installation exposes the required repository permissions'
          : 'GitHub App installation is missing the required repository permissions'
        : connection.errors.length
          ? `GitHub App installation permissions could not be verified: ${connection.errors[0]}`
          : 'GitHub App installation permissions could not be verified yet',
      fix: 'Grant Issues: read/write and Metadata: read-only in the GitHub App repository permissions.',
    });

    checks.push({
      id: 'github-app-installation-events',
      ok: Boolean(connection.installation?.hasRequiredEvents),
      level: 'recommended',
      summary: connection.installation
        ? connection.installation.hasRequiredEvents
          ? 'GitHub App installation exposes the required webhook events'
          : 'GitHub App installation is missing required webhook events'
        : connection.errors.length
          ? `GitHub App webhook events could not be verified: ${connection.errors[0]}`
          : 'GitHub App webhook events could not be verified yet',
      fix: 'Enable both Issues and Issue comment events in the GitHub App settings.',
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
    connection,
  });

  return {
    schemaVersion: 2,
    publisherMode,
    canCreatePublisher,
    existingWebAppTrialReady: Boolean(existingWebAppTrialReady),
    githubAppTrialReady: Boolean(githubAppTrialReady),
    e2eRepo: connection.installation?.repo || e2eRepo || 'uDeserve/signalforge-e2e-lab',
    webhookSecretConfigured,
    githubAppConnection: connection,
    setupStages,
    checks,
  };
}
