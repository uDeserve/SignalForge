# Architecture

High level flow:

```text
User / Product Surface
-> SignalForge Adapter / Widget / Runtime Provider
-> Intake API
-> Triage Engine
-> FeedbackCase Store
-> GitHub App Bridge
-> GitHub Issues / Discussions
-> Owner Decisions
-> Agent / Skill Bridge
```

The platform should keep raw intake, canonical cases, GitHub publication, and execution separate.

## Triage Architecture

The triage engine should be split conceptually into two layers:

1. deterministic intake processing
2. semantic triage

The deterministic layer should handle:

- schema validation
- privacy filtering
- coarse dedupe hints
- empty or noisy input rejection

The semantic layer should handle:

- merging similar feedback
- translating user language into product or engineering language
- identifying likely bug vs ux vs feature vs support
- generating issue-ready summaries

The semantic layer may use an LLM, but the surrounding platform should remain model-agnostic.

## Publication And Execution Separation

SignalForge should separate:

- case creation
- issue publication
- execution approval
- agent delegation

This avoids coupling "issue exists" with "engineering work is already approved".

Agent and MCP integrations should consume case context through the platform boundary, not by treating GitHub as the source of truth.

Runtime collection should preferably come from mature providers such as Sentry or GlitchTip.

## GitHub Publisher Boundary

SignalForge should not hardcode a single GitHub auth mode into the API layer.

The API should depend on a publisher boundary such as `githubPublisher.publishCase(...)`.

This lets the same case publication flow support:

- local preview mode
- PAT-backed issue creation
- GitHub App-backed issue creation

The current GitHub App layer now supports:

- installation token provider boundary
- GitHub App JWT signing
- installation token exchange

It still keeps a static installation token mode for testing and controlled fallback.

The important architectural rule is:

- case normalization stays in SignalForge
- issue rendering stays in SignalForge
- GitHub auth and transport stay behind the publisher boundary

This keeps the eventual GitHub App migration additive instead of a rewrite.

SignalForge should own:

- event normalization
- case correlation
- GitHub publication
- owner decision capture
- agent delegation
