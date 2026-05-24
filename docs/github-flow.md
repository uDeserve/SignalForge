# GitHub Flow

GitHub is the collaboration and publication surface for SignalForge.

The GitHub App bridge is responsible for:

- creating issues or discussions
- listening to issue comments
- translating maintainer commands into structured decisions
- syncing publication state

GitHub is downstream, not the system of record.

## Decision Model

SignalForge should prefer a single maintainer decision point.

The intended flow is:

1. feedback or runtime signals enter SignalForge
2. triage normalizes, clusters, and summarizes them
3. SignalForge publishes a GitHub issue automatically when the case is publishable
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

SignalForge should publish a normalized issue, not raw user feedback.

Each issue should include:

- normalized summary
- affected surface
- user impact
- supporting evidence
- cluster size
- confidence
- open questions
- recommended next action
