# Roadmap

FeedbackMesh is moving toward a mature open source product for small web application teams and independent developers.

The north star is clear:

- connect to an existing web app quickly
- reduce setup to near one-click where practical
- make the GitHub App workflow boring, reliable, and production-ready

## Phase 0: Foundations

- lock object model
- lock API contract
- define GitHub flow
- define privacy rules
- define MVP scope

## Phase 1: Core Product Skeleton

- repo skeleton
- intake API
- widget skeleton
- GitHub App skeleton

## Phase 2: Case Formation

- triage
- deduplication
- case publication
- decision parsing

## Phase 3: Operational Depth

- agent delegation bridge
- runtime signal integration
- privacy hardening

Current progress:

- agent delegation bridge: partial API surface is in place and still needs deeper execution handoff
- runtime signal integration: in progress with direct runtime ingestion and a Sentry-style ingest route already present
- privacy hardening: baseline implemented for public GitHub publication
- easy adoption baseline: setup-stage diagnostics, verify flow, and hosted setup sessions are now in code
- test baseline: `npm test` passes in an unrestricted environment; build, lint, and typecheck surfaces are still mostly placeholder scripts

## Phase 4: Easy Adoption

- ship a reusable feedback widget for existing web apps
- make the adapter path easier to drop into small products
- add first-class Sentry and GlitchTip bridges
- improve operator visibility through webhook activity and audit logging

## Phase 5: Mature GitHub App Experience

- tighten the install-the-app workflow
- reduce manual setup after installation
- harden issue publication and webhook sync
- make bot behavior feel reliable enough for everyday team use

Current code already covers:

- repo-aware installation lookup by repository
- permission and webhook-event inspection
- webhook signature verification and comment-driven decision sync

## Phase 6: One-Click Productization

- reusable starter templates for web products
- easier hosted or self-serve setup paths
- sane defaults for small teams
- simpler onboarding flows that feel close to one-click
- GitHub App installation discovery and connection state
- one-click verification for publish and decision sync readiness

Current code already covers:

- machine-readable scaffold templates
- setup status and verify endpoints
- hosted setup sessions with agent-readable contracts

## Immediate Next Work

The highest-leverage next steps are now concrete:

1. replace placeholder `build`, `lint`, and `typecheck` scripts with real repo-wide commands
2. turn hosted setup sessions into a tighter install loop with callback or polling-based GitHub App return handling
3. expose a cleaner operator-facing connection and readiness surface on top of the existing API status objects
4. deepen delegation from stored records into a real downstream execution bridge

If these land, FeedbackMesh will look materially more mature both as a product and as an open-source engineering surface.

## Productization Tracks

FeedbackMesh now needs to be evaluated on two separate workflow tracks.

### Agent-First Track

Current local-code baseline:

- machine-readable setup and integration contracts
- `doctor --json` and `verify --json`
- scaffold templates for browser and React preset paths
- hosted setup sessions with `agent-contract`, binding code, and `nextAgentAction`
- repo-aware GitHub App installation discovery and staged readiness checks
- explicit published-state reporting in hosted session state and agent contract

Current gap:

- the remote hosted surface now exists and is usable, but the operator still has to manually bounce between GitHub App install UI and setup-session confirmation
- there is still no callback-driven or UI-driven completion loop after install
- the contract is machine-usable, but the hosted story still needs a simpler public-facing entry doc and fewer manual branching points

Immediate goal:

- tighten the hosted install-return loop with callback or polling support
- preserve the current explicit contract while reducing the remaining human coordination steps

Hosted validation as of `2026-06-09`:

- `GET /health` -> `200`
- `GET /setup/status` -> `200`
- `GET /projects` -> `200`
- `POST /setup/sessions` -> `201`
- `GET /setup/sessions/:id/agent-contract` -> `200`
- full remote flow already validated through first publish and republish idempotency on `https://feedbackmesh.launchhub.icu`

### Operator-First Track

Current baseline:

- the core GitHub-native publish and decision-sync loop is live
- setup diagnostics and verification primitives already exist in code

Current gap:

- the human-facing install and recovery path is still less polished than the agent-facing protocol surface
- status is still more API- and CLI-shaped than operator-shaped

Immediate goal:

- keep this track secondary until the remote agent-first flow is fully deployed and verified

## Phase 7: Downstream Execution

- delegated fix execution
- PR creation and review loop
- merge and deploy handoff patterns

## What Success Looks Like

FeedbackMesh feels mature when a small team can:

1. connect an existing app quickly
2. install the GitHub App into the repo
3. let the bot publish and sync decisions reliably
4. operate without needing a second internal triage system

See also:

- `docs/one-click-adoption-plan.md`
