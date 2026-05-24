# API Contract

The platform API should support:

- feedback submission ingestion
- runtime error ingestion
- case triage
- case retrieval
- case context retrieval
- GitHub publication
- owner decision capture
- agent delegation

The API should remain explicit, idempotent where needed, and conservative about privacy.

The easy-start adapter should map app-level feedback and runtime errors into these platform APIs without requiring the application developer to learn the internal case model first.

## Triage Boundary

The platform should expose a triage boundary between raw intake and case publication.

That boundary may be implemented by:

- deterministic heuristics
- an LLM-assisted triage layer
- or a hybrid pipeline

The contract should stay stable even if the underlying triage strategy changes.

## Publication Policy

The API should support automatic issue publication after triage.

The important owner decision is not "should this be published as an issue" but:

- should this published issue enter the execution loop

This means the platform should preserve:

- publication state
- execution decision state
- delegation state

as separate concepts.
