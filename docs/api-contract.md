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
