# Architecture

FeedbackMesh is designed as a case intelligence layer between noisy product signals and GitHub-native engineering action.

The architecture is intentionally opinionated:

- raw submissions are not the main product object
- aggregated cases are the main product object
- GitHub is the maintainer decision surface
- automation happens after decision boundaries, not before them

## System Shape

```text
user feedback + runtime signals
-> adapters and intake
-> triage and aggregation
-> canonical case store
-> publication policy
-> GitHub issue publication
-> maintainer decision
-> downstream execution / agents
```

This matters because most teams already know how to collect feedback.

What they do not have is a clean architectural boundary between collection, case formation, publication, and action.

FeedbackMesh creates that boundary.

## Core Layers

## 1. Intake Layer

The intake layer accepts raw product signals from:

- feedback widgets
- app adapters
- runtime monitoring providers
- direct API clients

Its job is not to make high-value decisions.

Its job is to normalize input safely and preserve the evidence needed for later case synthesis.

Typical responsibilities:

- schema validation
- source tagging
- route, release, and environment capture
- privacy filtering
- evidence preservation

## 2. Triage And Aggregation Layer

This is the core of FeedbackMesh.

The system should not treat every submission as a future issue.

It should determine whether a new submission:

- creates a new case
- strengthens an existing case
- adds evidence without changing the current decision

The aggregation layer combines:

- deterministic signals such as route, feature, release, source kind, and runtime fingerprint
- semantic signals such as normalized summary, problem type, affected surface, and user impact

The output is a canonical case with a stable clustering identity.

That case becomes the unit that maintainers reason about.

## 3. Canonical Case Store

The store keeps the state that matters for decision-making:

- canonical title and summary
- linked submissions
- evidence counts
- classification
- publication state
- maintainer decisions
- downstream execution state

This separation is important.

A raw submission is evidence.

A case is a maintained product object.

An issue is a publication artifact.

Those should not collapse into one table-shaped idea.

## 4. Publication Policy Layer

Publication is a policy decision, not an incidental side effect.

FeedbackMesh should evaluate whether a case is ready to publish based on:

- actionability
- source quality
- aggregation strength
- publish target
- current publication state

This enables the system to support both:

- `publish_now`
- `hold_and_watch`

without losing the value of the aggregated case.

## 5. GitHub Publisher Boundary

GitHub integration should stay behind a publisher boundary.

That boundary owns:

- authentication mode
- transport
- issue creation
- comment capture inputs

FeedbackMesh itself should continue to own:

- case formation
- issue rendering
- publication policy
- decision state handling

This keeps GitHub auth strategy replaceable without changing the case pipeline.

It also allows multiple publication modes:

- preview
- PAT-backed publication
- GitHub App-backed publication

## 6. Maintainer Decision Layer

Issue creation is not the final decision.

FeedbackMesh treats maintainer action as a separate state transition after publication.

That distinction matters because:

- a team may want automatic issue creation
- but still require human judgment before execution

The system should therefore preserve separate state for:

- case readiness
- publication
- maintainer decision
- delegation or execution

## 7. Downstream Execution Layer

After a maintainer decision, FeedbackMesh can hand off context to:

- engineers
- automation jobs
- coding agents
- workflow tools

The handoff should use case context, not raw intake fragments.

That is the architectural payoff of aggregation:

downstream systems receive one cleaner object instead of many low-signal events.

## LLM Position In The Architecture

The LLM is optional and advisory.

It may help with:

- semantic clustering
- canonical summary generation
- problem typing
- affected-surface inference
- issue-ready wording

But correctness must survive LLM failure.

If the model is unavailable or returns invalid structure, FeedbackMesh should still produce safe results through deterministic fallback behavior.

## Design Rules

The architecture should continue to preserve these rules:

- intake is not publication
- publication is not execution
- issues are outputs, not the source of truth
- cases are the primary stateful object
- heuristics must remain a valid safety fallback

## What This Architecture Optimizes For

- fewer duplicate issues
- higher-signal maintainer inboxes
- safer GitHub automation
- easier adoption by existing product teams
- clean downstream context for agents and workflows

The system is not optimized to become a general-purpose support suite.

It is optimized to help teams decide what deserves engineering attention.
