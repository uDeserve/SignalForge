# Hosted Agent-First Flow

This document describes the real hosted onboarding path that is currently usable for FeedbackMesh agents.

Verified deployment on 2026-06-09:

- base URL: `https://feedbackmesh.launchhub.icu`
- post-install landing page: `GET /setup`
- health: `GET /health` -> `200`
- setup status: `GET /setup/status` -> `200`
- hosted session creation: `POST /setup/sessions` -> `201`

## What This Flow Is For

Use this path when:

- FeedbackMesh is already deployed
- an agent needs to onboard a product into that hosted service
- GitHub App installation still requires a human click, but the rest of the flow should stay machine-readable

The repo now includes a minimal helper for this flow:

```bash
npm run fm:hosted -- create --name "Omni Lingua" --app-name omni_lingua --repo uDeserve/omni_lingua
```

## Current Happy Path

1. `POST /setup/sessions`
   Send `name`, `appName`, `repo`, and optional `actor`.
2. Read the returned `state.installUrl` and `state.binding.code`.
3. Ask the human to install the GitHub App with that install URL.
4. Poll `GET /setup/sessions/:id` or `GET /setup/sessions/:id/agent-contract`.
   If install detection succeeds, the session can auto-advance to `awaiting_first_submission`.
5. Only if auto-detection does not complete, call `POST /setup/sessions/:id/github-binding`
   and confirm the repo with the binding code.
6. Patch the target app with:
- `VITE_SIGNALFORGE_ENDPOINT=https://feedbackmesh.launchhub.icu`
   - `VITE_SIGNALFORGE_PROJECT_KEY=<projectKey>`
   - `VITE_SIGNALFORGE_APP_NAME=<appName>`
7. Send the first submission to `POST /submissions` with `X-SignalForge-Project-Key`.
8. Run `POST /triage/run`.
9. Poll `GET /setup/sessions/:id` or `GET /setup/sessions/:id/agent-contract` until the session reaches `live`.

## Important Session States

- `awaiting_github_app_install`
- `awaiting_install_binding_confirmation`
- `awaiting_first_submission`
- `awaiting_first_case`
- `ready_for_first_publish`
- `live`

The contract also exposes `instructions.nextAgentAction`, which is the safest field for an agent to follow directly.

In the current recommended path, the agent should treat `wait_for_human_github_install_then_poll_setup_session` as the normal post-install action.

`awaiting_install_binding_confirmation` is still a valid state, but after the latest setup-session polish it is mainly the fallback branch when install detection has not auto-confirmed the repo binding yet.

## What Is Already Proven

The hosted flow at `feedbackmesh.launchhub.icu` has already been exercised through:

- session creation
- binding confirmation
- first submission
- first case creation
- first GitHub issue publication
- repeated publish on the same case returning `alreadyPublished: true`

## Current Remaining Gaps

- GitHub App install still needs a human browser step
- there is no install callback or automatic return-to-session flow yet
- the operator-facing UI is still thinner than the agent-facing protocol
