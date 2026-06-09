# Live E2E Verification

This document records the first real SignalForge deployment and end-to-end verification run.

## Goal

Prove that SignalForge works as a real operator loop, not only as local mocks or script-level tests.

The target validation was:

- accept user feedback through the API
- triage it into a case
- publish a real GitHub issue
- capture a real maintainer decision from a GitHub issue comment
- sync that decision back into the SignalForge case store

## Deployed Topology

- public domain: `https://sf.launchhub.icu`
- API health endpoint: `GET /health`
- GitHub webhook endpoint: `POST /webhooks/github`
- reverse proxy: Caddy
- API service: `127.0.0.1:8787`
- GitHub App webhook service: `127.0.0.1:8788`

The deployment was isolated from other apps on the server:

- separate app directory
- separate ports
- separate Caddy site block
- no reuse of existing project processes

## GitHub App Shape

Verified app mode:

- `GITHUB_PUBLISHER=app`
- JWT signing from private key
- installation token exchange
- issue creation through GitHub App installation auth

Minimum confirmed GitHub App config:

- Repository permissions:
  - `Issues: Read and write`
  - `Metadata: Read-only`
- Subscribe to events:
  - `Issues`
  - `Issue comment`

## Verified Results

Real issue publication was confirmed on the test repo:

- repo: `uDeserve/signalforge-e2e-lab`
- issue created by the GitHub App bot

Real decision sync was also confirmed:

- a case was published into GitHub
- the maintainer commented on the issue with a slash command
- SignalForge received the real GitHub webhook
- SignalForge stored a decision record
- the case status changed in the API store

One verified sequence was:

```text
published case status: accepted
owner comments /defer on the GitHub issue
SignalForge stores decision: defer
case status becomes: triaging
```

This confirms the first production-like loop:

```text
feedback -> case -> GitHub issue -> owner comment -> webhook -> case update
```

## What This Proves

- FeedbackMesh is already usable as a GitHub-native owner decision surface
- the "publish first, owner decides once" model works in practice
- GitHub App auth is viable for the publication layer
- issue comments are a workable command surface for the first execution loop

## Known Gaps

This E2E does not yet prove the full autonomous repair loop.

Still missing:

- real web widget installed in a product
- real runtime monitor integration through Sentry or GlitchTip
- issue comment -> skill or agent delegation execution
- delegated fix -> PR -> merge -> deploy automation
- stronger observability on webhook processing and operator audit trails

## Operational Lessons

- the most common GitHub App setup mistake is subscribing only to `Issues` and forgetting `Issue comment`
- SSL verification should stay enabled when the endpoint is served behind valid HTTPS
- FeedbackMesh should log webhook event names and decision outcomes explicitly to reduce debugging time

## Recommended Next Build Steps

- ship an embeddable feedback widget
- ship a minimal hosted or self-hosted intake setup guide
- add a first-class Sentry and GlitchTip bridge
- implement delegated execution from issue comments such as `/delegate <skill>`
- add better webhook logs and recent activity views
