import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cliPath = path.resolve(repoRoot, 'scripts', 'signalforge_cli.mjs');
const envExample = path.resolve(repoRoot, '.env.example');
const isolatedEnvKeys = Object.freeze([
  'DEEPSEEK_API_KEY',
  'GITHUB_PUBLISHER',
  'GITHUB_TOKEN',
  'GITHUB_APP_ID',
  'GITHUB_APP_INSTALLATION_ID',
  'GITHUB_APP_INSTALLATION_TOKEN',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_WEBHOOK_SECRET',
  'SIGNALFORGE_DB_PATH',
  'SIGNALFORGE_E2E_REPO',
  'SIGNALFORGE_ENV_FILE',
  'SIGNALFORGE_ENV_EXAMPLE_FILE',
]);

let importCounter = 0;

async function runCli(args, { cwd, env, fetchImpl } = {}) {
  const previousArgv = [...process.argv];
  const previousCwd = process.cwd();
  const previousExitCode = process.exitCode;
  const previousLog = console.log;
  const previousError = console.error;
  const previousFetch = globalThis.fetch;
  const stdout = [];
  const stderr = [];
  const envPatch = { ...(env ?? {}) };
  const previousEnv = {};

  for (const key of isolatedEnvKeys) {
    previousEnv[key] = process.env[key];
  }

  console.log = (...values) => {
    stdout.push(values.join(' '));
  };
  console.error = (...values) => {
    stderr.push(values.join(' '));
  };
  process.argv = [process.execPath, cliPath, ...args];
  process.exitCode = undefined;
  if (cwd) process.chdir(cwd);

  for (const key of isolatedEnvKeys) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(envPatch)) {
    process.env[key] = String(value);
  }
  if (fetchImpl) {
    globalThis.fetch = fetchImpl;
  }

  try {
    await import(`${pathToFileURL(cliPath).href}?test_run=${importCounter++}`);
    return {
      status: process.exitCode ?? 0,
      stdout: stdout.length ? `${stdout.join('\n')}\n` : '',
      stderr: stderr.length ? `${stderr.join('\n')}\n` : '',
    };
  } catch (error) {
    return {
      status: process.exitCode ?? 1,
      stdout: stdout.length ? `${stdout.join('\n')}\n` : '',
      stderr: stderr.length ? `${stderr.join('\n')}\n` : '',
      error,
    };
  } finally {
    process.argv = previousArgv;
    if (cwd) process.chdir(previousCwd);
    process.exitCode = previousExitCode;
    console.log = previousLog;
    console.error = previousError;
    globalThis.fetch = previousFetch;

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signalforge-cli-'));
  fs.copyFileSync(envExample, path.join(dir, '.env.example'));
  return dir;
}

test('signalforge cli init creates .env from example', async () => {
  const fixture = createFixture();
  const result = await runCli(['init'], {
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

test('signalforge cli doctor reports preview mode readiness with default env', async () => {
  const fixture = createFixture();
  fs.copyFileSync(envExample, path.join(fixture, '.env'));
  const result = await runCli(['doctor'], {
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

test('signalforge cli doctor reports missing github app config when app mode is selected', async () => {
  const fixture = createFixture();
  fs.writeFileSync(
    path.join(fixture, '.env'),
    'GITHUB_PUBLISHER=app\nGITHUB_APP_ID=\nGITHUB_APP_INSTALLATION_ID=\nGITHUB_APP_PRIVATE_KEY=\n',
    'utf8',
  );
  const result = await runCli(['doctor'], {
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

test('signalforge cli doctor reports app workflow gaps beyond auth', async () => {
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
  const result = await runCli(['doctor'], {
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

test('signalforge cli doctor json reports discovered github app connection metadata', async () => {
  const fixture = createFixture();
  const { privateKey } = await import('node:crypto').then(({ generateKeyPairSync }) =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }),
  );
  fs.writeFileSync(
    path.join(fixture, '.env'),
    [
      'GITHUB_PUBLISHER=app',
    ].join('\n'),
    'utf8',
  );

  const result = await runCli(['doctor', '--json'], {
    cwd: repoRoot,
    env: {
      SIGNALFORGE_ENV_FILE: path.join(fixture, '.env'),
      SIGNALFORGE_ENV_EXAMPLE_FILE: path.join(fixture, '.env.example'),
      GITHUB_PUBLISHER: 'app',
      GITHUB_APP_ID: '123',
      GITHUB_APP_PRIVATE_KEY: privateKey,
      SIGNALFORGE_E2E_REPO: 'uDeserve/signalforge-e2e-lab',
    },
    fetchImpl: async (url) => {
      if (String(url).endsWith('/repos/uDeserve/signalforge-e2e-lab/installation')) {
        return {
          ok: true,
          async json() {
            return {
              id: 999,
              app_id: 123,
              app_slug: 'signalforge',
              repository_selection: 'selected',
              permissions: { issues: 'write', metadata: 'read' },
              events: ['issues', 'issue_comment'],
              account: { login: 'uDeserve', type: 'Organization' },
            };
          },
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.publisherMode, 'app');
  assert.equal(typeof parsed.githubAppConnection, 'object');
  assert.equal(parsed.githubAppConnection.discovered, true);
  assert.equal(parsed.githubAppConnection.installation.installationId, '999');
  assert.equal(parsed.githubAppConnection.installation.repo, 'uDeserve/signalforge-e2e-lab');
});

test('signalforge cli doctor supports machine-readable json output', async () => {
  const fixture = createFixture();
  fs.copyFileSync(envExample, path.join(fixture, '.env'));
  const result = await runCli(['doctor', '--json'], {
    cwd: repoRoot,
    env: {
      SIGNALFORGE_ENV_FILE: path.join(fixture, '.env'),
      SIGNALFORGE_ENV_EXAMPLE_FILE: path.join(fixture, '.env.example'),
    },
  });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.publisherMode, 'preview');
  assert.equal(typeof parsed.setupStages, 'object');
  assert.equal(parsed.setupStages.appConnected, true);
  assert.equal(Array.isArray(parsed.checks), true);
});

test('signalforge cli verify emits machine-readable verification output', async () => {
  const fixture = createFixture();
  fs.copyFileSync(envExample, path.join(fixture, '.env'));
  const result = await runCli(['verify', '--json'], {
    cwd: repoRoot,
    env: {
      SIGNALFORGE_ENV_FILE: path.join(fixture, '.env'),
      SIGNALFORGE_ENV_EXAMPLE_FILE: path.join(fixture, '.env.example'),
      GITHUB_PUBLISHER: 'preview',
      SIGNALFORGE_E2E_REPO: 'uDeserve/signalforge-e2e-lab',
    },
  });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.setup.publisherMode, 'preview');
  assert.equal(parsed.submission.accepted, true);
  assert.equal(typeof parsed.triage.caseId, 'string');
  assert.equal(typeof parsed.publish.ok, 'boolean');
  assert.equal(typeof parsed.decisionSync.nextStep, 'string');
});

test('signalforge cli manifest emits an agent-readable setup contract', async () => {
  const result = await runCli(['manifest'], { cwd: repoRoot });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.product, 'FeedbackMesh');
  assert.equal(parsed.frontendIntegration.recommendedExport, 'installFeedbackMeshPreset');
  assert.equal(Array.isArray(parsed.installModes), true);
});

test('signalforge cli integration emits an agent-readable integration contract', async () => {
  const result = await runCli(['integration'], { cwd: repoRoot });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.product, 'FeedbackMesh');
  assert.equal(parsed.integrationTarget, 'existing_web_app');
  assert.equal(parsed.integrationModes[0].export, 'installFeedbackMeshPreset');
});

test('signalforge cli scaffold emits a machine-readable template payload', async () => {
  const result = await runCli(['scaffold', 'browser-preset', '--json'], { cwd: repoRoot });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.templateId, 'browser-preset');
  assert.equal(Array.isArray(parsed.files), true);
  assert.equal(parsed.files.some((file) => file.path === 'main.js'), true);
});

test('signalforge cli scaffold can write template files to disk', async () => {
  const fixture = createFixture();
  const outputDir = path.join(fixture, 'scaffold-out');
  const result = await runCli(['scaffold', 'react-preset', '--output', outputDir], { cwd: repoRoot });
  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(outputDir, 'AppShell.jsx')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'client-entry.jsx')), true);
});
