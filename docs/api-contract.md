# API Contract

SignalForge exposes an API for turning raw signals into stateful, reviewable cases.

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

This is one of the most important product behaviors in SignalForge.

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

In practical terms, the platform needs endpoints for:

- submission ingestion
- triage execution
- case listing
- case detail and context retrieval
- GitHub publication
- maintainer decision capture

The exact route names can evolve, but the boundary between these responsibilities should stay clear.

## Integration Promise

An application integrating SignalForge should be able to do the following with minimal setup:

1. send feedback or errors
2. let SignalForge aggregate them into cases
3. review those cases through the inbox API
4. allow GitHub publication when policy permits
5. capture downstream maintainer decisions

That is the practical promise of the API:

simple intake, stronger case formation, cleaner engineering action.
