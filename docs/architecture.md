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

Agent and MCP integrations should consume case context through the platform boundary, not by treating GitHub as the source of truth.

Runtime collection should preferably come from mature providers such as Sentry or GlitchTip.

SignalForge should own:

- event normalization
- case correlation
- GitHub publication
- owner decision capture
- agent delegation
