# SignalForge Agent README

This document is written for coding agents that need to integrate SignalForge into an existing web product with minimal guesswork.

If you are an agent, read these files first:

1. `signalforge.agent.json`
2. `signalforge.integration.json`
3. `docs/quick-start.md`

## What SignalForge Is

SignalForge is a feedback ops layer for existing web apps.

Its job is to:

- capture user feedback
- capture runtime errors
- aggregate repeated reports into cases
- publish issues through GitHub or a GitHub App
- keep maintainer decisions inside GitHub

## Preferred Integration Mode

For small web teams, prefer:

- package: `@signalforge/adapter`
- export: `installSignalForgePreset`

This is the shortest browser-side path.

## Minimal Browser Patch

Add this import:

```js
import { installSignalForgePreset } from '@signalforge/adapter';
```

Add this bootstrap call:

```js
installSignalForgePreset({
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
npm run sf:init
npm run sf:doctor
npm run sf:start
```

Use this command to print a machine-readable setup contract:

```bash
node scripts/signalforge_cli.mjs manifest
```

Use this command to print a machine-readable integration contract:

```bash
node scripts/signalforge_cli.mjs integration
```

Use this command to print a machine-readable scaffold payload:

```bash
node scripts/signalforge_cli.mjs scaffold browser-preset --json
```

Use this command to write scaffold files to disk:

```bash
node scripts/signalforge_cli.mjs scaffold react-preset --output ./signalforge-scaffold
```

Use this command to print machine-readable readiness diagnostics:

```bash
node scripts/signalforge_cli.mjs doctor --json
```

## Verification Path

After patching the target app:

1. run `npm run sf:doctor`
2. run `node scripts/run_readerapp_feedback_sample.mjs`
3. verify that SignalForge creates or merges cases

If GitHub App mode is being used:

1. install the GitHub App into the target repository
2. configure app auth env
3. run `node scripts/run_github_app_publish_e2e.mjs`
4. verify maintainer decision sync through webhook flow

## GitHub App Goal

The intended mature operator flow is:

- install the app
- bring the bot into the repository
- configure once
- let SignalForge publish issues and sync decisions through GitHub

## Agent Guidance

- Prefer the preset path over manual wiring unless the host app needs custom integration.
- Do not assume a hosted SignalForge service exists; use repo-local commands unless the target project already has a deployed endpoint.
- Prefer patching the application bootstrap or client entrypoint.
- Prefer adding the widget mount point to the main app shell or layout.
- After patching, verify with commands, not only static inspection.

## Useful Repo Paths

- `signalforge.agent.json`
- `signalforge.integration.json`
- `docs/quick-start.md`
- `docs/github-app-setup.md`
- `packages/adapter/src/index.js`
- `examples/agent/browser-preset/`
- `examples/agent/react-preset/`
