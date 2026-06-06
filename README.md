# SignalForge

<p align="center">
  <strong>Feedback ops for small web teams shipping on GitHub.</strong>
</p>

<p align="center">
  Plug into an existing web app, turn noisy feedback into decision-ready cases, and let a GitHub App handle the issue loop.
</p>

<p align="center">
  <a href="./docs/vision.md"><img alt="Fast web app integration" src="https://img.shields.io/badge/fast%20integration-existing%20web%20apps-0F172A?style=flat-square&labelColor=EAF0F8" /></a>
  <a href="./docs/github-app-setup.md"><img alt="GitHub App workflow" src="https://img.shields.io/badge/GitHub%20App-bring%20the%20bot%20in-0B3B66?style=flat-square&labelColor=EDF7FF" /></a>
  <a href="./docs/live-e2e.md"><img alt="Live workflow verified" src="https://img.shields.io/badge/live%20workflow-verified-065F46?style=flat-square&labelColor=ECFDF3" /></a>
</p>

<p align="center">
  <a href="./docs/vision.md">Vision</a> ·
  <a href="./docs/quick-start.md">Quick Start</a> ·
  <a href="./docs/github-app-setup.md">GitHub App Setup</a> ·
  <a href="./docs/architecture.md">Architecture</a> ·
  <a href="./docs/api-contract.md">API Contract</a> ·
  <a href="./docs/live-e2e.md">Live E2E</a>
</p>

SignalForge is built for small web application teams and independent developers who already have users, already use GitHub, and do not want to build a full internal feedback ops stack.

The product goal is simple:

- connect to an existing web app fast
- keep setup close to one-click where possible
- let a GitHub App handle publication and maintainer workflow with minimal operator friction

Small-team repo-local path:

```bash
npm run sf:init
npm run sf:doctor
npm run sf:start
```

Agent-friendly setup contract:

- `signalforge.agent.json`
- `signalforge.integration.json`
- `AGENT_README.md`
- `node scripts/signalforge_cli.mjs manifest`
- `node scripts/signalforge_cli.mjs integration`
- `node scripts/signalforge_cli.mjs scaffold browser-preset --json`
- `node scripts/signalforge_cli.mjs doctor --json`

<p align="center">
  <img src="./docs/assets/signalforge-hero-image2.png" alt="SignalForge hero graphic" width="100%" />
</p>

> Plug in fast. Publish cleanly. Keep the decision loop in GitHub.

| Integrate | Publish | Operate |
| --- | --- | --- |
| Add SignalForge to an existing web app through the adapter, widget, or direct API without reshaping the product stack. | Aggregate repeated reports into one case, then publish only when policy says the issue is ready. | Install the GitHub App, bring the bot into the repo, and keep maintainer actions inside the normal GitHub workflow. |

## Why Teams Adopt It

Most small product teams already have enough incoming signal.

What they usually lack is a lightweight way to turn that signal into clear engineering action without:

- building an internal triage tool
- buying a heavyweight support suite
- forcing engineers into another dashboard

SignalForge is meant to close that gap.

## Core Experience

### 1. Fast Integration For Existing Web Apps

SignalForge is designed to sit on top of an existing app, not replace it.

You can use:

- `@signalforge/adapter` for application-side integration
- the feedback widget for fast end-user capture
- direct API ingestion for custom pipelines
- runtime signal ingestion alongside tools like Sentry or GlitchTip

### 2. Near One-Click Operator Flow

The operational goal is to feel close to "plug it in and go":

- run the API with repo-level env
- connect the app through the adapter
- install the GitHub App into the target repo
- let SignalForge publish and sync decisions through the bot workflow

For small teams, that matters more than deep admin surfaces.

### 3. Mature GitHub App Workflow

SignalForge is intentionally GitHub-native.

The long-term mature path is not "copy tokens around forever."

It is:

- install the GitHub App
- grant the repo access it needs
- let SignalForge publish issues through the app
- let maintainers act through comments and normal GitHub review habits

That is the model we want to make production-ready and boring in the best way.

## What It Does

- feedback intake for end-user submissions
- runtime signal ingestion and case enrichment
- aggregation-aware triage with stable clustering
- canonical case summaries and evidence rollups
- automatic GitHub issue publication when policy says `publish_now`
- owner decisions synced from GitHub comments
- context retrieval for follow-up automation and delegation
- adapter-first integration for existing web apps

## System Flow

<p align="center">
  <img src="./docs/assets/signalforge-flow-image2.png" alt="SignalForge system flow graphic" width="100%" />
</p>

```text
existing web app
-> SignalForge adapter / widget / API
-> aggregated case
-> GitHub App issue publication
-> maintainer decision in GitHub
-> execution / delegation
```

## Quick Start Shape

For most teams, adoption should look like this:

1. run the SignalForge API
2. connect the existing web app through the adapter
3. install the GitHub App into the repo
4. let feedback start flowing into aggregated cases
5. let the bot publish issues and sync maintainer decisions

If you want the shortest path to a working setup, start with:

- `docs/quick-start.md`
- `docs/github-app-setup.md`
- `npm run sf:doctor`

## Example Integration

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

## Verified End-to-End

SignalForge has already been validated against a real GitHub App flow:

- deployed behind HTTPS at `sf.launchhub.icu`
- real GitHub App issue publication
- real GitHub webhook delivery
- real owner decision sync from GitHub issue comments back into SignalForge state

Verified flow:

```text
feedback submission
-> case creation / aggregation
-> GitHub App issue publish
-> owner comments /accept or /defer
-> GitHub webhook
-> SignalForge decision record + case status update
```

See `docs/live-e2e.md` for deployment notes, verification details, and known gaps.

## Why It Feels Different

SignalForge is opinionated about one thing:

the goal is not to create more tickets.

the goal is to create fewer, better decision surfaces.

That means:

- duplicate reports should usually collapse into one case
- issue publication can be automatic
- issue creation is not the same as engineering approval
- maintainers should make one real decision in GitHub, not in a second admin system

## What SignalForge Is

- a lightweight feedback ops layer for existing web apps
- a GitHub-native case aggregation engine
- a bot-friendly issue publication and decision loop
- an automation handoff point for agents and workflows

## What SignalForge Is Not

- a full support desk
- a full issue tracker
- a replacement for Sentry or GlitchTip
- a heavyweight internal tooling platform

## GitHub App Maturity Direction

The GitHub App path is no longer just conceptual.

What already exists:

- GitHub App publisher support
- JWT signing
- installation token exchange
- issue publication through app auth
- webhook-driven decision sync

What we want this to become:

- install the app
- invite the bot into the repo
- configure once
- operate through GitHub with minimal manual setup after that

That is the maturity bar.

## Runtime Signals

SignalForge does not try to replace mature exception monitoring tools.

Recommended layering:

- Sentry or GlitchTip for runtime collection
- SignalForge for aggregation, case correlation, publication, and orchestration

## Docs

- `docs/vision.md`
- `docs/quick-start.md`
- `docs/object-model.md`
- `docs/api-contract.md`
- `docs/github-flow.md`
- `docs/github-app-setup.md`
- `docs/privacy.md`
- `docs/mvp.md`
- `docs/architecture.md`
- `docs/roadmap.md`
- `docs/llm-triage.md`
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

## Repository Scripts

- `node scripts/start_api_with_env.mjs`
- `node scripts/run_readerapp_feedback_sample.mjs`
- `node scripts/run_github_issue_publish_e2e.mjs`
- `node scripts/run_github_app_publish_e2e.mjs`
