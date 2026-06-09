# Quick Start

FeedbackMesh is designed for small web teams and independent developers who want a fast setup path, not an integration project.

The intended experience is:

1. initialize FeedbackMesh
2. connect an existing web app
3. install the GitHub App
4. let the bot publish and sync decisions through GitHub

The preferred FeedbackMesh-branded entrypoints are:

```bash
npm run fm:init
npm run fm:doctor
node scripts/feedbackmesh_cli.mjs verify
npm run fm:start
```

Legacy `sf:*` scripts and `scripts/signalforge_cli.mjs` still work and remain supported for compatibility.

## Zero-To-Running Commands

For the shortest repo-local path:

```bash
npm run fm:init
npm run fm:doctor
node scripts/feedbackmesh_cli.mjs verify
npm run fm:start
```

What these do:

- `fm:init` creates a local `.env` from `.env.example` if missing
- `fm:doctor` checks whether the current setup is ready for preview, PAT, or GitHub App workflow
- `feedbackmesh_cli verify` runs a synthetic submission, triage, publication, and decision-sync readiness check
- `fm:start` runs the FeedbackMesh API using the repo env

For coding agents and automation:

- preferred machine-readable setup contract: `feedbackmesh.agent.json`
- preferred machine-readable integration contract: `feedbackmesh.integration.json`
- legacy machine-readable setup contract: `signalforge.agent.json`
- legacy machine-readable integration contract: `signalforge.integration.json`
- agent-oriented guide: `AGENT_README.md`
- CLI manifest output: `node scripts/feedbackmesh_cli.mjs manifest`
- CLI integration output: `node scripts/feedbackmesh_cli.mjs integration`
- CLI scaffold output: `node scripts/feedbackmesh_cli.mjs scaffold browser-preset --json`
- machine-readable doctor output: `node scripts/feedbackmesh_cli.mjs doctor --json`
- machine-readable verify output: `node scripts/feedbackmesh_cli.mjs verify --json`

## Path A: Existing Web App In Fast Mode

Use this path when you already have a running web app and want feedback flowing quickly.

### Step 1: Start the API

```bash
npm run fm:start
```

### Step 2: Connect The App

Use the adapter inside the existing application.

Shortest preset:

```js
import { installFeedbackMeshPreset } from '@feedbackmesh/adapter';

installFeedbackMeshPreset({
  endpoint: 'https://signalforge.example.com',
  projectKey: 'proj_readerapp',
  appName: 'readerapp',
  environment: 'production',
  release: '1.2.3',
});
```

If you want more control, use the lower-level adapter form:

```js
import { createFeedbackMeshAdapter } from '@feedbackmesh/adapter';

const sf = createFeedbackMeshAdapter({
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

### Step 3: Verify Repo-Local Readiness

Run:

```bash
node scripts/feedbackmesh_cli.mjs verify
```

Expected result:

- FeedbackMesh creates a synthetic submission and case
- the publish path reports whether publication is ready or skipped
- decision-sync guidance is printed for the current publisher mode

### Step 4: Verify Real Intake

Run the sample:

```bash
node scripts/run_readerapp_feedback_sample.mjs
```

Expected result:

- FeedbackMesh receives feedback
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
- `npm run fm:doctor`

### Step 2: Configure App Auth

For the current CLI and API path, repo-aware JWT auth can discover the installation from the target repo:

```bash
GITHUB_PUBLISHER=app
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
SIGNALFORGE_E2E_REPO=owner/repo
GITHUB_WEBHOOK_SECRET=...
```

If you are using the standalone GitHub App E2E script, keep `GITHUB_APP_INSTALLATION_ID` set as well. Static installation-token mode is also supported.

### Step 3: Inspect Readiness And Connection State

Run:

```bash
npm run fm:doctor
```

Expected result:

- publisher mode is `app`
- the connected repository is shown when installation discovery succeeds
- required permissions and webhook events are checked
- staged readiness such as `publish test ready` and `decision sync ready` is reported

### Step 4: Verify End-To-End Publication

Recommended first check:

```bash
node scripts/feedbackmesh_cli.mjs verify
```

Optional standalone E2E script:

```bash
node scripts/run_github_app_publish_e2e.mjs
```

Expected result:

- a case is created
- FeedbackMesh publishes a GitHub issue through the app
- the issue URL is printed

Before running the standalone E2E script, check readiness with:

```bash
npm run fm:doctor
```

### Step 5: Verify Decision Sync

Inside GitHub, leave a maintainer command such as:

- `/accept`
- `/defer`
- `/delegate`
- `/reject`
- `/needs-info`
- `/publish`
- `/merge-into <caseId>`

Expected result:

- GitHub sends the webhook
- FeedbackMesh updates case state
- maintainers stay inside the normal repo workflow

## Recommended First Production Shape

For a small team, the cleanest first deployment looks like this:

```text
existing app
-> FeedbackMesh adapter
-> FeedbackMesh API
-> GitHub App publication
-> maintainer decisions in GitHub
```

This gives you the highest leverage with the lowest process overhead.

## What "One-Click" Means Here

FeedbackMesh is not pretending every production setup is literally one button today.

The product standard we are pursuing is:

- minimal setup steps
- strong defaults
- install-once GitHub App workflow
- no second operator dashboard required for everyday use

That is the bar for mature adoption.
