import fs from 'node:fs';

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

const hasStaticInstallationToken = Boolean(process.env.GITHUB_APP_INSTALLATION_TOKEN);
const hasJwtInputs = Boolean(
  process.env.GITHUB_APP_ID &&
  process.env.GITHUB_APP_INSTALLATION_ID &&
  process.env.GITHUB_APP_PRIVATE_KEY
);

if (!hasStaticInstallationToken && !hasJwtInputs) {
  console.error(
    JSON.stringify(
      {
        error: 'missing_github_app_config',
        message:
          'Provide either GITHUB_APP_INSTALLATION_TOKEN or the full GITHUB_APP_ID + GITHUB_APP_INSTALLATION_ID + GITHUB_APP_PRIVATE_KEY set.',
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

process.env.GITHUB_PUBLISHER = 'app';

await import('./run_github_issue_publish_e2e.mjs');
