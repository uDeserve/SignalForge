# Omni Lingua Agent-First Closure

This document defines the real next proof point for FeedbackMesh.

The current example product is Omni Lingua / reader. The remaining gap is no longer generic platform capability. The gap is that this exact example repo has not yet completed the hosted GitHub App loop on its own repository.

## What Is Already Proven

- FeedbackMesh hosted setup sessions work
- GitHub App installation detection and binding flows work
- first publish and republish idempotency work on the hosted deployment
- Omni Lingua already has a real product-side feedback bridge and runtime signal shape

## What Is Not Yet Proven

These steps still need to happen on the real example repo:

1. install the `FeedbackMesh` GitHub App into the Omni Lingua repository
2. create a hosted setup session for that exact repository
3. patch the live Omni Lingua env with the hosted `VITE_SIGNALFORGE_*` values
4. send the first real submission from the Omni Lingua product path
5. publish the first real GitHub issue into the Omni Lingua repository
6. leave a maintainer command such as `/defer` or `/accept`
7. verify that the decision sync lands back in FeedbackMesh state

## Required Runbook

1. Create a hosted setup session:
   `POST /setup/sessions` with `name`, `appName`, and `repo`.
2. Have a human install the GitHub App from `state.installUrl`.
3. Poll `GET /setup/sessions/:id` until install detection completes, or use `POST /setup/sessions/:id/github-binding` as fallback.
4. Patch Omni Lingua with:
   `VITE_SIGNALFORGE_ENDPOINT=https://feedbackmesh.launchhub.icu`
   `VITE_SIGNALFORGE_PROJECT_KEY=<projectKey>`
   `VITE_SIGNALFORGE_APP_NAME=<appName>`
5. Trigger one real feedback submission from the reader surface.
6. Confirm the hosted session advances through `awaiting_first_submission`, `awaiting_first_case`, and `ready_for_first_publish`.
7. Publish the first case and record the GitHub issue URL.
8. Leave a maintainer command on that issue and confirm the case state changes.

## Ready-To-Run Commands

Create the Omni Lingua hosted session:

```bash
npm run fm:hosted -- create --name "Omni Lingua" --app-name omni_lingua --repo uDeserve/omni_lingua
```

Read the latest setup state:

```bash
npm run fm:hosted -- status --session <sessionId>
```

Read the machine-readable agent contract:

```bash
npm run fm:hosted -- contract --session <sessionId>
```

Only if auto-detection does not complete, confirm the binding manually:

```bash
npm run fm:hosted -- confirm-binding --session <sessionId> --repo uDeserve/omni_lingua --binding-code <sfbind_code>
```

The `create` command prints the exact `VITE_SIGNALFORGE_ENDPOINT`, `VITE_SIGNALFORGE_PROJECT_KEY`, and `VITE_SIGNALFORGE_APP_NAME` values that should be patched into Omni Lingua.

## Exit Criteria

Treat this closure as complete only when all of these artifacts exist:

- the Omni Lingua repo shows the FeedbackMesh GitHub App installation
- a hosted setup session for Omni Lingua reaches `live`
- at least one real issue exists in the Omni Lingua repo from the app
- at least one maintainer decision comment has synced back into FeedbackMesh
- the final evidence can be linked from README and case-study docs without caveats

## Why This Matters

Until this run is complete, Omni Lingua is still a strong integration story but not yet a finished example-repo proof. Once it is complete, FeedbackMesh can credibly claim that an agent-first product onboarding flow works not just in lab repos, but on the flagship dogfooding product itself.
