# GitHub Flow

GitHub is the collaboration and publication surface for SignalForge.

## Auth Strategy

FeedbackMesh should support two GitHub publication phases:

1. `PAT` or token-backed publication for local validation and first-project rollout
2. `GitHub App` publication for reusable, multi-repo, installable production usage

The product goal is the GitHub App path.

The development goal is not to block early validation on GitHub App setup.

That means:

- the case-to-issue contract should be validated first
- the publisher implementation should be swappable
- the API and case flow should not depend on whether auth comes from a PAT or an installation token

## Publisher Contract

FeedbackMesh should treat GitHub publication as a transport boundary.

The publisher interface should accept:

- case record
- target repo
- publication mode
- public or private repo rendering hint

The publisher should return:

- normalized repo target
- issue snapshot used for publication
- GitHub external identifiers like issue id, issue number, and URL

Today this allows:

- `preview` publisher for local-only issue-like publication
- `pat` publisher for real GitHub issue creation

Later this should allow:

- `app` publisher backed by GitHub App installation tokens

## GitHub App Skeleton

FeedbackMesh now has an `app` publisher boundary.

At the current stage it should be understood as:

- the publication transport is already separated from the case flow
- the publisher can already work with an installation token provider
- the publisher now supports full GitHub App JWT signing and installation token exchange
- a static installation token path still exists for controlled testing

This is intentional.

It keeps the system architecture stable while allowing early E2E flow validation with PAT mode.

The GitHub App bridge is responsible for:

- creating issues or discussions
- listening to issue comments
- translating maintainer commands into structured decisions
- syncing publication state

GitHub is downstream, not the system of record.

## Decision Model

FeedbackMesh should prefer a single maintainer decision point.

The intended flow is:

1. feedback or runtime signals enter FeedbackMesh
2. triage normalizes, clusters, and summarizes them
3. FeedbackMesh publishes a GitHub issue automatically when the case is publishable
4. the owner decides whether the issue should enter the execution loop

The owner should not need to pre-approve issue creation in the normal path.

## What The Issue Means

A published GitHub issue means:

- this case is worth looking at
- this case has been normalized enough to discuss
- this case is not yet accepted for execution

A published issue does not mean:

- engineering work has already been approved
- an agent should start writing code immediately
- the case is high-confidence truth

## Recommended Issue Labels

- `source:user-feedback`
- `source:runtime-signal`
- `type:bug`
- `type:ux`
- `type:feature`
- `type:support`
- `confidence:high`
- `confidence:medium`
- `confidence:low`
- `cluster:single`
- `cluster:multi-user`
- `decision:pending`
- `execution:accepted`
- `execution:rejected`
- `execution:deferred`

## Maintainer Commands

Maintainer decisions should happen on the issue after publication.

Recommended decision commands:

- `/sf accept`
- `/sf reject`
- `/sf defer`
- `/sf ask`

Optional execution metadata may follow, for example:

- `/sf accept owner=@alice priority=p1`
- `/sf defer reason="needs more signal"`

## Publication Standard

FeedbackMesh should publish a normalized issue, not raw user feedback.

Each issue should include:

- normalized summary
- affected surface
- user impact
- supporting evidence
- cluster size
- confidence
- open questions
- recommended next action
