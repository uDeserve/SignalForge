# API Contract

FeedbackMesh exposes an API for turning raw signals into stateful, reviewable cases.

The contract should feel stable from an integrator's point of view even as the triage logic evolves underneath it.

## Contract Goals

The API should make it easy to:

- submit end-user feedback
- submit runtime signals
- run triage and aggregation
- retrieve aggregated cases
- inspect case evidence and context
- publish cases to GitHub when policy allows
- capture maintainer decisions

The API should avoid forcing integrators to learn the full internal model before they can adopt the system.

## Product Objects

The contract should distinguish clearly between:

- submissions
- cases
- publications
- decisions

Those are related, but they are not interchangeable.

### Submission

A submission is a raw signal.

Examples:

- a user feedback report
- a runtime exception payload
- an adapter-captured complaint from an app surface

### Case

A case is the canonical aggregated object.

It should contain:

- canonical title and summary
- classification
- linked submission evidence
- readiness state
- publication status
- decision state

### Publication

A publication is the external artifact created from a case.

In this phase, that usually means a GitHub issue.

### Decision

A decision is the maintainer-controlled state that determines what should happen after publication.

## Behavioral Expectations

The contract should preserve a few strong guarantees.

### 1. Triage Is Aggregation-Aware

Running triage should not imply "create a new case every time."

Instead, triage should upsert against the canonical case pool:

- merge into an existing case when cluster identity matches
- create a new case when no matching case exists

This is one of the most important product behaviors in FeedbackMesh.

### 2. Cases Are The Inbox Surface

`GET /cases` should function as a real owner inbox API, not just a raw database listing.

It should return enough metadata for a maintainer or future frontend to act without fetching multiple extra resources for basic review.

That includes:

- title
- summary
- classification
- evidence counts
- latest seen time
- publish policy outcome
- publication state

### 3. Publication Is Policy-Driven

The API should support automatic publication, but only after policy evaluation.

This means:

- publication can happen automatically
- execution should still remain a separate decision boundary

### 4. LLM Use Must Stay Replaceable

The API contract must not depend on a specific model provider.

Clients should not have to care whether triage used:

- heuristics only
- heuristics plus LLM enrichment
- future hybrid approaches

The output contract matters more than the internal reasoning path.

## Contract Style

The API should be:

- explicit
- additive where possible
- safe by default
- privacy-conscious
- stable enough to support an adapter-first integration path

## Practical Endpoint Shape

The current codebase already exposes these practical boundaries.

### Setup And Verification

- `GET /setup/status`
  Returns staged readiness for preview, PAT, or GitHub App mode. Includes `publisherMode`, `checks`, `setupStages`, and GitHub App connection metadata when available.
- `POST /verify/run`
  Creates a synthetic submission, runs triage, attempts publication when ready, and reports decision-sync guidance.
- `POST /setup/sessions`
  Creates an agent-first hosted onboarding session and project record.
- `GET /setup/sessions/:id`
  Returns current hosted onboarding state, next stage, binding code state, blocking human action, and the latest auto-detected install progress.
- `GET /setup/sessions/:id/agent-contract`
  Returns a machine-readable setup contract for agents.
- `POST /setup/sessions/:id/github-binding`
  Fallback endpoint for confirming the human-completed GitHub App install against the setup session binding code when auto-detection does not finish cleanly.
- `POST /setup/sessions/:id/binding-code/refresh`
  Rotates the binding code for a setup session.
- `POST /projects`
- `GET /projects`
- `GET /projects/:id`
- `GET /projects/:id/github-connection`
- `POST /projects/:id/github-connection/refresh`

### Signal Ingestion

- submission ingestion
- runtime ingestion
- Sentry-style runtime ingestion adapter
- triage execution

Concrete routes:

- `POST /submissions`
- `POST /runtime-events`
- `POST /runtime-events/ingest/sentry`

When project-scoped onboarding is being used, FeedbackMesh expects a valid `X-SignalForge-Project-Key` header for ingestion routes.

### Case Review And Context

- case listing
- case detail and context retrieval

Concrete routes:

- `POST /triage/run`
- `GET /cases`
- `GET /cases/:id`
- `GET /cases/:id/context`

### Publication, Decisions, And Delegation

- GitHub publication
- maintainer decision capture
- delegation handoff

Concrete routes:

- `POST /cases/:id/publish`
- `POST /cases/:id/decisions`
- `GET /cases/:id/publications`
- `GET /cases/:id/decisions`
- `GET /cases/:id/delegations`
- `POST /delegations`

The exact route names can evolve, but the boundary between these responsibilities should stay clear.

For the current hosted `Agent-First` path, the intended post-install behavior is:

1. human installs the GitHub App
2. agent polls `GET /setup/sessions/:id` or `GET /setup/sessions/:id/agent-contract`
3. FeedbackMesh auto-confirms the binding when the target repo installation is detected
4. agent uses `POST /setup/sessions/:id/github-binding` only as a fallback recovery step

## Integration Promise

An application integrating FeedbackMesh should be able to do the following with minimal setup:

1. send feedback or errors
2. let FeedbackMesh aggregate them into cases
3. review those cases through the inbox API
4. allow GitHub publication when policy permits
5. capture downstream maintainer decisions

That is the practical promise of the API:

simple intake, stronger case formation, cleaner engineering action.
