# Contributing

FeedbackMesh is not trying to become another generic ticketing layer.

It is a GitHub-native case intelligence system that turns noisy feedback into fewer, higher-value engineering decisions.

Contributions should protect that focus.

## Product Principles

- cases are more important than raw submissions
- GitHub is the decision surface, not the intake surface
- automation should reduce maintainer work, not create more review steps
- privacy and operator control are product features, not cleanup tasks
- LLMs can assist triage, but system correctness cannot depend on them

## Good Contributions

The best contributions usually improve one of these areas:

- aggregation quality
- case clarity and evidence quality
- GitHub publication reliability
- adapter ergonomics for real product teams
- documentation that makes the product easier to adopt

## Change Standard

Keep changes:

- small enough to reason about
- explicit in behavior
- safe by default
- documented when public behavior changes

## Before You Open A PR

Make sure the change answers at least one of these questions:

- does this help collapse noise into clearer cases?
- does this help maintainers make a faster decision?
- does this improve real-world adoption or integration?
- does this preserve the GitHub-native product shape of FeedbackMesh?

If the answer is no, the change may still be useful, but it should be justified clearly.

## Development Direction

FeedbackMesh is currently strongest when used as:

- a feedback-to-issue engine
- an aggregation-aware triage layer
- a GitHub publication boundary
- an automation handoff point for follow-up execution

Please avoid pushing the project toward:

- a full support desk
- a generic issue tracker
- a replacement for runtime monitoring
- a broad internal tools platform without a clear case pipeline

## Documentation Contributions

Strong documentation work is high-value here.

Especially useful:

- clearer integration examples
- sharper product positioning
- real operator workflows
- end-to-end deployment notes

## Review Expectations

PRs should make the product simpler, sharper, or more credible.

If a contribution adds complexity, it should also clearly improve decision quality, operator leverage, or adoption.
