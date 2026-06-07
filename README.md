# SignalForge

<p align="center">
  <strong>The missing harness between user reality and AI-native software automation.</strong>
</p>

<p align="center">
  Modern automation already handles <em>issue -> code -> PR -> review</em>. SignalForge fills the missing upstream step: turning noisy user feedback and runtime pain into decision-ready GitHub issues that agents and engineering systems can actually execute on.
</p>

<p align="center">
  <a href="./docs/vision.md"><img alt="AI-native harness layer" src="https://img.shields.io/badge/AI--native-harness%20layer-111827?style=flat-square&labelColor=EEF2FF" /></a>
  <a href="./docs/quick-start.md"><img alt="Fast integration for existing apps" src="https://img.shields.io/badge/existing%20web%20apps-fast%20integration-0F172A?style=flat-square&labelColor=EAF0F8" /></a>
  <a href="./docs/github-app-setup.md"><img alt="GitHub App workflow" src="https://img.shields.io/badge/GitHub%20App-bring%20the%20bot%20in-0B3B66?style=flat-square&labelColor=EDF7FF" /></a>
  <a href="./AGENT_README.md"><img alt="Agent-friendly integration" src="https://img.shields.io/badge/agents-first--class%20install%20path-1D4ED8?style=flat-square&labelColor=EFF6FF" /></a>
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

SignalForge is built for small web application teams and independent developers who already have users, already ship on GitHub, and increasingly want AI systems to participate in the whole software loop.

If code generation, PR drafting, code review, and issue execution are already becoming automatable, the bottleneck shifts upstream. Most teams still have no reliable bridge from raw user pain to machine-actionable engineering intent.

SignalForge is that bridge.

It turns user pain, runtime friction, and product ambiguity into evidence-backed cases that are clean enough for GitHub workflows, maintainers, and coding agents to act on with confidence.

SignalForge can also be understood as:

- an AI-native feedback-to-issue harness
- a GitHub-native case intelligence layer
- an upstream issue generation layer for coding-agent workflows
- a user feedback aggregation system for modern web products

The product goal is still operationally simple:

- connect to an existing web app fast
- keep setup close to one-click where possible
- let a GitHub App handle publication and maintainer workflow with minimal operator friction
- expose enough structure that a coding agent can install and use it correctly with very little guesswork

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

## Project Status

- live GitHub App publication and webhook decision sync verified
- repo-local CLI for `sf:init`, `sf:doctor`, and `sf:start` is in place
- adapter-first integration path exists for existing web apps
- current maturity target is serious small-team adoption, not demo-only positioning

Trust signals:

- [Live E2E Verification](./docs/live-e2e.md)
- [Omni Lingua Case Study](./docs/case-studies/omni-lingua.md)
- [Reader Feedback Examples](./docs/case-studies/reader-feedback-to-case-examples.md)
- [Quick Start](./docs/quick-start.md)
- [One-Click Adoption Plan](./docs/one-click-adoption-plan.md)
- [Release Notes](./docs/releases/v0.1.0.md)
- [Changelog](./CHANGELOG.md)
- [Security Policy](./SECURITY.md)
- [Support](./SUPPORT.md)
- [License](./LICENSE)

## Why SignalForge Exists

The software loop is being automated from the middle outward.

Teams already have serious momentum around:

- issue-driven coding agents
- automated PR generation
- AI-assisted code review
- GitHub-native execution workflows

But those systems still depend on one fragile assumption:

that a high-quality issue already exists.

In practice, that assumption fails constantly. The real input is messy:

- confused user feedback
- repeated complaints with different wording
- support conversations with partial context
- runtime failures that never become coherent product work

SignalForge exists to make that upstream layer usable.

The ambition is not to become another inbox.

The ambition is to become the feedback harness that makes the rest of the software automation chain meaningfully more effective.

If someone is searching for tooling around AI-native feedback triage, GitHub issue automation, user feedback aggregation, or case intelligence for coding agents, this is the category SignalForge is built for.

## The Missing Layer In The AI-Native Stack

Most AI-native engineering stacks are getting strong at the downstream half:

- GitHub issue intake
- code generation
- PR creation
- review automation
- execution harnesses

What is still weak is the upstream half:

- messy user complaints
- vague support threads
- repeated "something feels broken" reports
- runtime pain disconnected from product context

SignalForge sits exactly in that gap.

It turns user reality into a smaller number of structured, evidence-backed cases so the rest of the automation stack has something clean to act on.

```text
user feedback + runtime pain
-> SignalForge intake and aggregation
-> decision-ready case
-> GitHub issue
-> coding agent / maintainer workflow
-> shipped fix
```

| Integrate | Publish | Operate |
| --- | --- | --- |
| Add SignalForge to an existing web app through the adapter, widget, or direct API without reshaping the product stack. | Aggregate repeated reports into one case, then publish only when policy says the issue is ready. | Install the GitHub App, bring the bot into the repo, and keep maintainer actions inside the normal GitHub workflow. |

## Why This Category Matters

If the feedback-to-issue layer is weak, the entire AI-native delivery chain downstream becomes brittle.

A coding agent can fix a well-scoped issue.

It cannot reliably rescue a chaotic stream of raw user complaints unless something upstream performs:

- aggregation
- normalization
- evidence synthesis
- policy-gated publication

That is the category SignalForge is trying to define clearly: not helpdesk software, not generic issue tracking, but the harness that converts product reality into automation-ready engineering objects.

## Why Teams Adopt It

Most small product teams already have enough signal.

What they usually lack is a lightweight way to turn that signal into clear engineering action without:

- building an internal triage tool
- buying a heavyweight support suite
- forcing engineers into another dashboard

SignalForge is meant to close that gap.

The bigger bet is that this becomes foundational infrastructure for AI-native product teams: not another dashboard, but the feedback harness that feeds the rest of the software automation chain.

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

### 4. Agent-Friendly By Design

SignalForge is also designed for the way modern teams actually work now: a human or operator often pastes a repo URL into Codex or another agent and expects the system to wire things up correctly.

That is why the repo includes:

- machine-readable integration contracts
- scaffold commands for common integration presets
- a dedicated `AGENT_README.md`
- repo-local verification commands instead of hand-wavy setup prose

If a product claims to be AI-native infrastructure, it should be installable not only by a careful human operator, but also by an agent working from repo context and a short instruction.

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

The point is not to make the feedback layer louder.

The point is to make the upstream automation boundary finally trustworthy.

## What SignalForge Is

- the intake and aggregation layer for AI-native software delivery
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

## Why Now

The industry is rapidly getting good at automating work after a good issue already exists.

The unresolved problem is how to create that good issue from noisy reality, repeatedly, safely, and with enough structure that agents can keep going.

That is the layer SignalForge is trying to make real.

## Built For Small Teams

SignalForge is deliberately shaped for the teams that feel this gap most sharply:

- startups with one main web product
- indie developers shipping fast on GitHub
- small product teams that want AI leverage without building a full internal ops stack first

Those teams do not need a giant platform.

They need fast integration, a GitHub-native workflow, and a system that starts converting feedback into better engineering inputs immediately.

## Docs

- `docs/vision.md`
- `docs/case-studies/omni-lingua.md`
- `docs/case-studies/mobile-lookup-friction.md`
- `docs/case-studies/backend-hang-user-pain.md`
- `docs/case-studies/reader-feedback-to-case-examples.md`
- `docs/case-studies/social-snippets.md`
- `docs/quick-start.md`
- `docs/one-click-adoption-plan.md`
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
