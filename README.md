# SignalForge

GitHub-native feedback triage and case publication layer.

SignalForge turns end-user feedback and runtime signals into structured engineering cases, then bridges those cases into GitHub and agent-driven execution workflows.

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
-> llm-assisted triage
-> FeedbackCase
-> automatic GitHub publication
-> maintainer execution decision
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

const unbind = sf.installGlobalErrorHandlers();
sf.mountFeedbackWidget(document.getElementById('sf-root'), {
  defaultOpen: false,
  includeContactField: true,
});
```

## Current Foundation

- submission -> case -> GitHub publication
- runtime signal -> case enrichment
- owner decisions via GitHub comments
- case context aggregation
- agent delegation records
- MCP bridge for case listing, context fetch, and delegation
- adapter-first easy start for web projects

## Verified Live E2E

SignalForge has now been validated against a real public GitHub App flow:

- deployed behind HTTPS at `sf.launchhub.icu`
- real GitHub App issue publication
- real GitHub webhook delivery
- real owner decision sync from GitHub issue comments back into SignalForge state

The verified flow is:

```text
feedback submission
-> case creation
-> GitHub issue publish
-> owner comments /accept or /defer on the issue
-> GitHub webhook
-> SignalForge decision record + case status update
```

See `docs/live-e2e.md` for the deployed topology, verification notes, and known gaps.

## GitHub Publication Modes

SignalForge currently supports a staged GitHub publication strategy:

- `preview`: local issue-like publication for flow validation
- `pat`: real GitHub issue creation through a repository token
- `app`: GitHub App publisher boundary with installation-token-based skeleton
  and JWT-based installation token exchange

The API flow should stay the same across these modes.

Only the publisher implementation should change.

## Product Principle

SignalForge should optimize for one maintainer decision, not two.

That means:

- SignalForge may publish a GitHub issue automatically after triage
- the owner does not need to approve issue creation first
- the owner makes the real decision at execution time:
  - accept
  - reject
  - defer
  - ask for more context

In this model, a GitHub issue is a decision surface, not an automatic commitment to engineering work.

## LLM Role

The LLM should not be treated as the final decision-maker for product changes.

Its first job is:

- merge similar raw feedback
- filter low-value noise and support-like content
- translate user language into engineering language
- produce decision-ready case summaries

The owner still decides whether a published issue should enter the execution loop.

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
- `docs/llm-triage.md`
- `docs/readerapp-e2e-sample.md`
- `docs/github-app-setup.md`
- `docs/live-e2e.md`

## LLM Setup

SignalForge can run in two modes:

- heuristic fallback only
- DeepSeek-backed LLM triage

Set these env vars to enable DeepSeek:

```bash
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

If no key is configured, SignalForge continues using heuristic triage.

For local startup with a repo-level `.env`, run:

```bash
node scripts/start_api_with_env.mjs
```

GitHub publisher env:

```bash
GITHUB_PUBLISHER=preview
GITHUB_TOKEN=
GITHUB_API_BASE_URL=https://api.github.com
GITHUB_APP_ID=
GITHUB_APP_INSTALLATION_ID=
GITHUB_APP_INSTALLATION_TOKEN=
GITHUB_APP_PRIVATE_KEY=
```

Use `GITHUB_PUBLISHER=pat` together with `GITHUB_TOKEN` when you want `/cases/:id/publish` to create a real GitHub issue.

Use `GITHUB_PUBLISHER=app` when you want to exercise the GitHub App publisher boundary.

`app` mode supports two variants:

- static installation token via `GITHUB_APP_INSTALLATION_TOKEN`
- real GitHub App auth via `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY`

The static token path is useful for controlled testing.

The JWT path is the intended production shape.
