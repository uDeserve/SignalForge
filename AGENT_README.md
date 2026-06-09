# FeedbackMesh Agent README

This document is written for coding agents that need to integrate FeedbackMesh into an existing web product with minimal guesswork.

If you are an agent, read these files first:

1. `feedbackmesh.agent.json`
2. `feedbackmesh.integration.json`
3. `docs/quick-start.md`
4. `docs/hosted-agent-first.md` if a hosted FeedbackMesh endpoint already exists

## What FeedbackMesh Is

FeedbackMesh is a feedback ops layer for existing web apps.

Its job is to:

- capture user feedback
- capture runtime errors
- aggregate repeated reports into cases
- publish issues through GitHub or a GitHub App
- keep maintainer decisions inside GitHub

## Preferred Integration Mode

For small web teams, prefer:

- package: `@feedbackmesh/adapter`
- export: `installFeedbackMeshPreset`

This is the shortest browser-side path.

## Minimal Browser Patch

Add this import:

```js
import { installFeedbackMeshPreset } from '@feedbackmesh/adapter';
```

Add this bootstrap call:

```js
installFeedbackMeshPreset({
  endpoint: 'https://signalforge.example.com',
  projectKey: 'proj_readerapp',
  appName: 'readerapp',
  environment: 'production',
  release: '1.2.3',
});
```

Add this DOM mount point somewhere in the app shell:

```html
<div id="sf-feedback-root"></div>
```

## Local Repo Setup Commands

Use these commands for the repo-local path:

```bash
npm run fm:init
npm run fm:doctor
node scripts/feedbackmesh_cli.mjs verify
npm run fm:start
```

Use this command to print a machine-readable setup contract:

```bash
node scripts/feedbackmesh_cli.mjs manifest
```

Use this command to print a machine-readable integration contract:

```bash
node scripts/feedbackmesh_cli.mjs integration
```

Use this command to print a machine-readable scaffold payload:

```bash
node scripts/feedbackmesh_cli.mjs scaffold browser-preset --json
```

Use this command to write scaffold files to disk:

```bash
node scripts/feedbackmesh_cli.mjs scaffold react-preset --output ./feedbackmesh-scaffold
```

Use this command to print machine-readable readiness diagnostics:

```bash
node scripts/feedbackmesh_cli.mjs doctor --json
```

Use this command to run a machine-readable setup and publish verification flow:

```bash
node scripts/feedbackmesh_cli.mjs verify --json
```

The current `doctor` output exposes staged readiness such as `repoConnected`, `githubAppInstalled`, `publishTestReady`, and `decisionSyncReady`. In GitHub App JWT mode it can also discover installation metadata from the target repo and report missing permissions or webhook events.

## Verification Path

Before patching the target app:

1. run `npm run fm:doctor`
2. run `node scripts/feedbackmesh_cli.mjs verify`
3. confirm whether publish and decision-sync readiness are already satisfied

After patching the target app:

1. run `node scripts/run_readerapp_feedback_sample.mjs`
2. verify that FeedbackMesh creates or merges cases
3. inspect `/cases` or the printed JSON payload for the created case

If GitHub App mode is being used:

1. install the GitHub App into the target repository
2. configure app auth env
3. run `npm run fm:doctor` or `GET /setup/status` and confirm repo, permissions, and events
4. run `node scripts/feedbackmesh_cli.mjs verify`
5. verify maintainer decision sync through webhook flow

If you need the standalone E2E script path, `node scripts/run_github_app_publish_e2e.mjs` still expects either a static installation token or the full `GITHUB_APP_ID + GITHUB_APP_INSTALLATION_ID + GITHUB_APP_PRIVATE_KEY` set.

## Hosted Onboarding Surface

FeedbackMesh now exposes an agent-first hosted onboarding path:

- `POST /setup/sessions` creates a project and setup session
- `GET /setup/sessions/:id` returns staged onboarding state
- `GET /setup/sessions/:id/agent-contract` returns a machine-readable install contract
- `POST /setup/sessions/:id/github-binding` remains available as a fallback confirmation endpoint
- `POST /setup/sessions/:id/binding-code/refresh` rotates the binding code

This path is meant for agents that need to pause on human GitHub App installation, then resume by polling the setup session until install detection completes. Manual binding confirmation is now the fallback path when auto-detection does not finish cleanly.

The currently verified hosted deployment is:

- endpoint: `https://sf.launchhub.icu`
- status: real session creation, binding confirmation, first publish, and republish idempotency validated on 2026-06-09
- workflow doc: `docs/hosted-agent-first.md`

## GitHub App Goal

The intended mature operator flow is:

- install the app
- bring the bot into the repository
- configure once
- let FeedbackMesh publish issues and sync decisions through GitHub

## Agent Guidance

- Prefer the preset path over manual wiring unless the host app needs custom integration.
- Do not assume a hosted FeedbackMesh service exists; use repo-local commands unless the target project already has a deployed endpoint.
- Prefer patching the application bootstrap or client entrypoint.
- Prefer adding the widget mount point to the main app shell or layout.
- After patching, verify with commands, not only static inspection.
- Keep using `signalforge.agent.json`, `signalforge.integration.json`, `SIGNALFORGE_*`, and `X-SignalForge-Project-Key` when a target environment still depends on legacy compatibility surfaces.

## Useful Repo Paths

- `feedbackmesh.agent.json`
- `feedbackmesh.integration.json`
- `signalforge.agent.json`
- `signalforge.integration.json`
- `docs/quick-start.md`
- `docs/github-app-setup.md`
- `packages/shared-config/src/setup-status.js`
- `packages/adapter/src/index.js`
- `examples/agent/browser-preset/`
- `examples/agent/react-preset/`
