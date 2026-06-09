# Privacy

FeedbackMesh must treat screenshots, logs, URLs, and free-form feedback text as potentially sensitive.

Default policy:

- redact before publish
- minimize raw retention
- prefer sanitized summaries
- distinguish public and private repository policy

Public GitHub publication should only contain sanitized summaries and structured metadata.

Internal case context may retain richer evidence for agent workflows, but that context should not be published by default.

Adapters and runtime integrations should default to safe forwarding:

- route and release are allowed
- raw stack traces are internal-only
- direct user identifiers should be omitted or redacted
- public issue publication should never depend on raw provider payloads
