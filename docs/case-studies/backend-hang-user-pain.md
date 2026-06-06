# Case: Backend Hang Surfaces First As User Pain

This case is derived from the documented Omni Lingua production incident:

- `docs/INCIDENT_2026-05-20_READER_PROD_BACKEND_HANG.md`

It shows why SignalForge matters even when the root problem is operational rather than purely interface-level.

## What Happened

The documented incident describes a state where:

- the frontend could still open
- the backend remained running but unhealthy
- health checks timed out
- users experienced unstable or timing-out API behavior
- a restart temporarily restored service

This is a classic example of a failure that users experience before the engineering team necessarily has a clean diagnosis.

## Why This Is A SignalForge Problem

Users do not report:

```text
backend has CLOSE_WAIT accumulation and unhealthy gunicorn workers
```

They report things like:

- the page opens but actions do not work
- reading is slow or hangs
- requests keep timing out
- the app feels broken today

That is exactly the upstream gap SignalForge is meant to handle.

## What A Good Aggregated Case Looks Like

Instead of scattering these reports into unrelated bug tickets, the system should converge on a case shape like:

```text
Reader frontend remains reachable while backend request path becomes unhealthy and times out
```

Useful preserved context includes:

- visible symptom: frontend loads but product actions fail or hang
- likely affected surfaces: profile refresh, reading progress, lookup, chapter actions
- impact: active reading session becomes unreliable
- operational hint: reproducible service degradation rather than one-off user confusion

## Why This Matters For Teams

Without aggregation, operational incidents often first appear as:

- vague product feedback
- scattered support complaints
- frontend-looking issues that are really backend failures

SignalForge helps compress that messy early warning layer into something that can enter a GitHub-native engineering workflow sooner.

## Why This Matters For AI-Native Workflows

Downstream coding agents are only useful once the issue boundary is clear.

This case illustrates that the highest-leverage automation may start before diagnosis is complete:

- collect repeated user-visible symptoms
- collapse them into one case
- publish one decision-ready issue
- let maintainers decide whether it is a UX bug, operational incident, or deeper platform problem

## Provenance Note

This case is based directly on the repository incident record.

The case summary intentionally translates operational symptoms into the user-facing problem shape that SignalForge is designed to capture.
