# One-Click Adoption Plan

FeedbackMesh is already reasonably mature at:

- intake and aggregation
- GitHub publication logic
- GitHub App transport
- agent-facing setup contracts
- API-first setup status and staged readiness diagnostics
- first-class repo-local verification through `feedbackmesh_cli verify`

It is not yet mature at the part small teams care about most:

`can I install this into my product and get to a working bot workflow without becoming my own integration engineer?`

This document defines the minimum productization plan for getting much closer to that standard.

## The Real Goal

The goal is not literal zero configuration.

The real goal is:

- install the GitHub App
- connect an existing web app quickly
- verify one test submission
- start operating in GitHub

without requiring the user to understand installation tokens, webhook edge cases, or low-level GitHub App auth details.

## Ideal User Flow

The target small-team operator flow should look like this:

1. create or open a FeedbackMesh workspace
2. connect the existing web app with the adapter or preset
3. click `Install GitHub App`
4. choose a repository
5. return to FeedbackMesh and see the installation automatically detected
6. click `Verify connection`
7. submit one test feedback item
8. watch FeedbackMesh create a case and publish a GitHub issue

That is the maturity bar.

## Current User Flow

Today the product offers a better technical path than the original manual flow, but it is still not yet a polished install surface.

Current repo-local and API capabilities already include:

- `feedbackmesh_cli doctor` with staged readiness output
- `feedbackmesh_cli verify` for synthetic publish verification
- repo-aware GitHub App installation discovery when JWT auth and target repo are known
- hosted setup sessions with agent-readable next actions and binding codes
- polling-based hosted setup-session auto-advance after GitHub App install detection

The remaining manual flow is closer to:

1. configure frontend env
2. configure FeedbackMesh env
3. install the GitHub App
4. sometimes still provide `installation_id` for the standalone E2E script path
5. provide app id and private key or installation token
6. configure webhook secret
7. inspect permissions and subscribed events
8. still rely on polling or API output instead of a cleaner callback or setup UI
9. run verification manually
10. inspect logs or JSON output

This is acceptable for early validation.

It is not yet the right product surface for small teams.

## What Is Fundamentally Unavoidable

Some steps cannot disappear because they are GitHub security boundaries:

- the GitHub App must be installed into the target repository
- the repository owner must grant issue permissions
- a webhook must be able to reach SignalForge
- SignalForge must hold a valid GitHub App identity

FeedbackMesh should not try to bypass these boundaries.

It should absorb everything around them.

## What Should Be Hidden By Product Design

The following should stop being manual operator work:

- discovering the GitHub App installation id
- deciding between private key flow and installation token flow for normal usage
- guessing whether `issue_comment` webhook events were enabled
- guessing which repo FeedbackMesh is currently connected to
- guessing whether the setup is complete enough for a real publish test

These are productization problems, not unavoidable complexity.

## Required Product Capabilities

The next meaningful version of FeedbackMesh adoption should include:

### 1. GitHub App Install Return Flow

Baseline status:

- repo-aware installation lookup by target repo already exists
- hosted setup sessions already expose binding codes and install URLs
- hosted setup sessions can now auto-confirm binding during polling when the target repo install is detected
- what is still missing is a smoother callback-driven or UI-driven install return that removes the remaining manual back-and-forth

After GitHub App installation, FeedbackMesh should be able to detect:

- installation id
- owner / repo target
- granted permissions
- whether required webhook events are enabled

This should remove the need for users to manually discover and paste installation metadata in the normal path.

### 2. Connection State Surface

Baseline status:

- this now exists in API-first form through `GET /setup/status`, `GET /projects/:id/github-connection`, and hosted setup session state
- what is still missing is a cleaner operator-facing UI and less fragmented status presentation

FeedbackMesh should expose a simple connection surface that answers:

- is GitHub App auth configured?
- which repository is connected?
- is webhook delivery configured?
- can FeedbackMesh publish now?
- can FeedbackMesh receive decision sync now?

This can start as an API-first status object before a full UI exists.

### 3. One-Click Verification

Baseline status:

- `POST /verify/run` and `node scripts/feedbackmesh_cli.mjs verify` are now implemented
- what is still missing is a more explicit end-user verify button and fewer manual follow-up steps

Users should not need to assemble their own validation steps.

FeedbackMesh should provide a first-class verify action that:

- creates a test submission
- runs triage
- verifies publish ability
- reports exactly what succeeded and what failed

The output should be readable by both humans and coding agents.

### 4. Install Wizard State Model

Baseline status:

- staged readiness now exists in code through `setupStages` and hosted setup-session state
- what is still missing is a more stable external schema and a first-class UI around it

The setup flow should become a clear checklist with machine-readable status:

- `adapter_connected`
- `github_app_installed`
- `repo_connected`
- `auth_ready`
- `webhook_ready`
- `publish_test_passed`
- `decision_sync_ready`

This model can power CLI output, API status, and future UI.

### 5. Safer Default Auth Path

For normal teams, FeedbackMesh should bias toward:

- full GitHub App auth
- repository installation discovery
- minimal direct exposure to installation tokens

Static installation token handling can remain as an advanced or fallback path.

## Minimum Phase Plan

### Phase A: Productize The Current CLI And API

Deliver:

- setup status endpoint
- richer `sf:doctor` output grouped by install stage
- explicit guidance for the connected repo and webhook status
- repo-scoped verification command

Success condition:

- a technical user can understand setup failures without reading low-level docs

Current code status:

- delivered in baseline form through `/setup/status`, `doctor --json`, and `verify`
- still needs a less script-heavy operator experience

### Phase B: Add GitHub App Connection Discovery

Deliver:

- GitHub App install callback or polling-based installation discovery
- automatic installation id capture
- repo selection and repo connection status

Success condition:

- users no longer manually hunt for `GITHUB_APP_INSTALLATION_ID` in the normal path

Current code status:

- repo-aware installation discovery and permission or event inspection already exist
- polling-based install return is now in place for hosted setup sessions
- automatic callback-driven install return is still missing

### Phase C: Add Verify Workflow

Deliver:

- one action that submits a test item and verifies publication
- decision sync verification guidance
- clear pass / fail state output

Success condition:

- a small team can tell whether FeedbackMesh is operational without reading internal scripts

Current code status:

- implemented at the CLI and API layer
- still needs a more productized front door

## What We Should Not Do Yet

Do not jump immediately into:

- a heavy admin dashboard
- generic multi-tenant account systems
- broad workflow builders
- support-desk-style approval queues

The highest-leverage productization work is still around:

- install
- connect
- verify
- operate in GitHub

## How To Measure Progress

FeedbackMesh is getting closer to one-click adoption when:

- fewer env vars are required in the normal path
- installation id discovery becomes automatic
- setup failures are visible as structured status instead of hidden docs knowledge
- a new repo can be connected and verified in minutes
- coding agents can perform the install path with fewer repo-specific instructions

## Short Version

FeedbackMesh does not need to make GitHub security boundaries disappear.

It needs to make them feel boring.

That is the real productization standard for small-team adoption.
