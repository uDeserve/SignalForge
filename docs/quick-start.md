# Quick Start

SignalForge is designed for small web teams and independent developers who want a fast setup path, not an integration project.

The intended experience is:

1. initialize SignalForge
2. connect an existing web app
3. install the GitHub App
4. let the bot publish and sync decisions through GitHub

## Zero-To-Running Commands

For the shortest repo-local path:

```bash
npm run sf:init
npm run sf:doctor
npm run sf:start
```

What these do:

- `sf:init` creates a local `.env` from `.env.example` if missing
- `sf:doctor` checks whether the current setup is ready for preview, PAT, or GitHub App workflow
- `sf:start` runs the SignalForge API using the repo env

For coding agents and automation:

- machine-readable setup contract: `signalforge.agent.json`
- machine-readable integration contract: `signalforge.integration.json`
- agent-oriented guide: `AGENT_README.md`
- CLI manifest output: `node scripts/signalforge_cli.mjs manifest`
- CLI integration output: `node scripts/signalforge_cli.mjs integration`
- CLI scaffold output: `node scripts/signalforge_cli.mjs scaffold browser-preset --json`
- machine-readable doctor output: `node scripts/signalforge_cli.mjs doctor --json`

## Path A: Existing Web App In Fast Mode

Use this path when you already have a running web app and want feedback flowing quickly.

### Step 1: Start the API

```bash
npm run sf:start
```

### Step 2: Connect The App

Use the adapter inside the existing application.

Shortest preset:

```js
import { installSignalForgePreset } from '@signalforge/adapter';

installSignalForgePreset({
  endpoint: 'https://signalforge.example.com',
  projectKey: 'proj_readerapp',
  appName: 'readerapp',
  environment: 'production',
  release: '1.2.3',
});
```

If you want more control, use the lower-level adapter form:

```js
import { createSignalForgeAdapter } from '@signalforge/adapter';

const sf = createSignalForgeAdapter({
  endpoint: 'https://signalforge.example.com',
  projectKey: 'proj_readerapp',
  appName: 'readerapp',
  environment: 'production',
  release: '1.2.3',
});

await sf.captureFeedback({ body: 'Save button freezes on mobile.' });
const unbind = sf.installGlobalErrorHandlers();
```

Optional:

- mount the feedback widget
- send runtime errors through the adapter
- ingest runtime signals from Sentry or GlitchTip alongside user feedback

### Step 3: Verify Intake

Run the sample:

```bash
node scripts/run_readerapp_feedback_sample.mjs
```

Expected result:

- SignalForge receives feedback
- cases are created or merged
- the case inbox becomes reviewable through the API

## Path B: GitHub App In Fast Mode

Use this path when you want the mature bot workflow instead of personal-token issue publishing.

### Step 1: Install The GitHub App

- install the app into the target repository
- grant issue permissions
- enable `Issues` and `Issue comment` webhook events

See:

- `docs/github-app-setup.md`
- `npm run sf:doctor`

### Step 2: Configure App Auth

For the intended mature path:

```bash
GITHUB_PUBLISHER=app
GITHUB_APP_ID=...
GITHUB_APP_INSTALLATION_ID=...
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
SIGNALFORGE_E2E_REPO=owner/repo
```

### Step 3: Verify End-To-End Publication

```bash
node scripts/run_github_app_publish_e2e.mjs
```

Expected result:

- a case is created
- SignalForge publishes a GitHub issue through the app
- the issue URL is printed

Before running this, check readiness with:

```bash
npm run sf:doctor
```

### Step 4: Verify Decision Sync

Inside GitHub, leave a maintainer command such as:

- `/accept`
- `/defer`
- `/delegate`

Expected result:

- GitHub sends the webhook
- SignalForge updates case state
- maintainers stay inside the normal repo workflow

## Recommended First Production Shape

For a small team, the cleanest first deployment looks like this:

```text
existing app
-> SignalForge adapter
-> SignalForge API
-> GitHub App publication
-> maintainer decisions in GitHub
```

This gives you the highest leverage with the lowest process overhead.

## What "One-Click" Means Here

SignalForge is not pretending every production setup is literally one button today.

The product standard we are pursuing is:

- minimal setup steps
- strong defaults
- install-once GitHub App workflow
- no second operator dashboard required for everyday use

That is the bar for mature adoption.
