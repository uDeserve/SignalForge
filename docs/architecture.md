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

SignalForge should own:

- event normalization
- case correlation
- GitHub publication
- owner decision capture
- agent delegation
