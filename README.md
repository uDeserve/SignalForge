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

## Docs

- `docs/vision.md`
- `docs/object-model.md`
- `docs/api-contract.md`
- `docs/github-flow.md`
- `docs/privacy.md`
- `docs/mvp.md`
- `docs/architecture.md`
- `docs/roadmap.md`
