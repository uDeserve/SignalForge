# SignalForge

GitHub-native feedback triage and case publication layer.

SignalForge turns end-user feedback and runtime signals into structured engineering cases, then bridges actionable cases into GitHub and agent-driven execution workflows.

## What This Is

- a feedback intake layer
- a case triage layer
- a GitHub publication bridge
- an owner decision capture layer
- an optional agent delegation bridge

## What This Is Not

- a full support desk
- a full issue tracker
- a full error monitoring platform
- a full CI/CD system
- a full auto-fix bot

## Core Flow

```text
user feedback / runtime error
-> submission
-> triage
-> FeedbackCase
-> GitHub publication
-> maintainer decision
-> agent or skill delegation
```

## Easy Start

SignalForge now includes an adapter-first integration path for existing web apps.

The intended setup is:

```text
your app
-> @signalforge/adapter
-> SignalForge API
-> case correlation / GitHub / agent delegation
```

The adapter is meant to be the easy-start layer for early-stage teams:

- capture end-user feedback
- capture app errors
- attach app context like route, release, and environment
- forward Sentry or GlitchTip style events into SignalForge

Example:

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
await sf.captureError(new Error('reader timeout'));
```

## Current Foundation

- submission -> case -> GitHub publication
- runtime signal -> case enrichment
- owner decisions via GitHub comments
- case context aggregation
- agent delegation records
- MCP bridge for case listing, context fetch, and delegation
- adapter-first easy start for web projects

## Runtime Signals

SignalForge does not try to replace mature exception monitoring tools.

Recommended layering:

- Sentry or GlitchTip for runtime collection
- SignalForge for case correlation, publication, and agent orchestration

This keeps SignalForge focused on the engineering loop instead of low-level SDK responsibilities.

## Docs

- `docs/vision.md`
- `docs/object-model.md`
- `docs/api-contract.md`
- `docs/github-flow.md`
- `docs/privacy.md`
- `docs/mvp.md`
- `docs/architecture.md`
- `docs/roadmap.md`
