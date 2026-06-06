import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cliPath = path.resolve(repoRoot, 'scripts', 'signalforge_cli.mjs');
const envExample = path.resolve(repoRoot, '.env.example');

function runCli(args, { cwd, env } = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signalforge-cli-'));
  fs.copyFileSync(envExample, path.join(dir, '.env.example'));
  return dir;
}

test('signalforge cli init creates .env from example', () => {
  const fixture = createFixture();
  const result = runCli(['init'], {
    cwd: repoRoot,
    env: {
      SIGNALFORGE_ENV_FILE: path.join(fixture, '.env'),
      SIGNALFORGE_ENV_EXAMPLE_FILE: path.join(fixture, '.env.example'),
    },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Created \.env from \.env\.example/);
  assert.equal(fs.existsSync(path.join(fixture, '.env')), true);
});

test('signalforge cli doctor reports preview mode readiness with default env', () => {
  const fixture = createFixture();
  fs.copyFileSync(envExample, path.join(fixture, '.env'));
  const result = runCli(['doctor'], {
    cwd: repoRoot,
    env: {
      SIGNALFORGE_ENV_FILE: path.join(fixture, '.env'),
      SIGNALFORGE_ENV_EXAMPLE_FILE: path.join(fixture, '.env.example'),
    },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Publisher mode: preview/);
  assert.match(result.stdout, /Existing web app trial ready: yes/);
  assert.match(result.stdout, /GitHub App trial ready: no/);
});

test('signalforge cli doctor reports missing github app config when app mode is selected', () => {
  const fixture = createFixture();
  fs.writeFileSync(
    path.join(fixture, '.env'),
    'GITHUB_PUBLISHER=app\nGITHUB_APP_ID=\nGITHUB_APP_INSTALLATION_ID=\nGITHUB_APP_PRIVATE_KEY=\n',
    'utf8',
  );
  const result = runCli(['doctor'], {
    cwd: repoRoot,
    env: {
      SIGNALFORGE_ENV_FILE: path.join(fixture, '.env'),
      SIGNALFORGE_ENV_EXAMPLE_FILE: path.join(fixture, '.env.example'),
    },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Publisher mode: app/);
  assert.match(result.stdout, /GitHub App auth is incomplete/);
  assert.match(result.stdout, /Finish GitHub App env setup/);
});

test('signalforge cli doctor reports app workflow gaps beyond auth', () => {
  const fixture = createFixture();
  fs.writeFileSync(
    path.join(fixture, '.env'),
    [
      'GITHUB_PUBLISHER=app',
      'GITHUB_APP_ID=123',
      'GITHUB_APP_INSTALLATION_ID=456',
      'GITHUB_APP_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----',
      'SIGNALFORGE_E2E_REPO=owner/repo',
    ].join('\n'),
    'utf8',
  );
  const result = runCli(['doctor'], {
    cwd: repoRoot,
    env: {
      SIGNALFORGE_ENV_FILE: path.join(fixture, '.env'),
      SIGNALFORGE_ENV_EXAMPLE_FILE: path.join(fixture, '.env.example'),
    },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /GitHub App JWT flow configured/);
  assert.match(result.stdout, /E2E repository: owner\/repo/);
  assert.match(result.stdout, /Webhook secret configured: no/);
  assert.match(result.stdout, /webhook-based decision sync is still incomplete/i);
});

test('signalforge cli doctor supports machine-readable json output', () => {
  const fixture = createFixture();
  fs.copyFileSync(envExample, path.join(fixture, '.env'));
  const result = runCli(['doctor', '--json'], {
    cwd: repoRoot,
    env: {
      SIGNALFORGE_ENV_FILE: path.join(fixture, '.env'),
      SIGNALFORGE_ENV_EXAMPLE_FILE: path.join(fixture, '.env.example'),
    },
  });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.publisherMode, 'preview');
  assert.equal(Array.isArray(parsed.checks), true);
});

test('signalforge cli manifest emits an agent-readable setup contract', () => {
  const result = runCli(['manifest'], { cwd: repoRoot });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.product, 'SignalForge');
  assert.equal(parsed.frontendIntegration.recommendedExport, 'installSignalForgePreset');
  assert.equal(Array.isArray(parsed.installModes), true);
});

test('signalforge cli integration emits an agent-readable integration contract', () => {
  const result = runCli(['integration'], { cwd: repoRoot });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.product, 'SignalForge');
  assert.equal(parsed.integrationTarget, 'existing_web_app');
  assert.equal(parsed.integrationModes[0].export, 'installSignalForgePreset');
});

test('signalforge cli scaffold emits a machine-readable template payload', () => {
  const result = runCli(['scaffold', 'browser-preset', '--json'], { cwd: repoRoot });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.templateId, 'browser-preset');
  assert.equal(Array.isArray(parsed.files), true);
  assert.equal(parsed.files.some((file) => file.path === 'main.js'), true);
});

test('signalforge cli scaffold can write template files to disk', () => {
  const fixture = createFixture();
  const outputDir = path.join(fixture, 'scaffold-out');
  const result = runCli(['scaffold', 'react-preset', '--output', outputDir], { cwd: repoRoot });
  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(outputDir, 'AppShell.jsx')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'client-entry.jsx')), true);
});
