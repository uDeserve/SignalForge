# One-Click Adoption Plan

SignalForge is already reasonably mature at:

- intake and aggregation
- GitHub publication logic
- GitHub App transport
- agent-facing setup contracts

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

1. create or open a SignalForge workspace
2. connect the existing web app with the adapter or preset
3. click `Install GitHub App`
4. choose a repository
5. return to SignalForge and see the installation automatically detected
6. click `Verify connection`
7. submit one test feedback item
8. watch SignalForge create a case and publish a GitHub issue

That is the maturity bar.

## Current User Flow

Today the operator flow is closer to:

1. configure frontend env
2. configure SignalForge env
3. install the GitHub App
4. find `installation_id`
5. provide app id and private key or installation token
6. configure webhook secret
7. verify subscribed events
8. run a script manually
9. inspect logs and output

This is acceptable for early validation.

It is not yet the right product surface for small teams.

## What Is Fundamentally Unavoidable

Some steps cannot disappear because they are GitHub security boundaries:

- the GitHub App must be installed into the target repository
- the repository owner must grant issue permissions
- a webhook must be able to reach SignalForge
- SignalForge must hold a valid GitHub App identity

SignalForge should not try to bypass these boundaries.

It should absorb everything around them.

## What Should Be Hidden By Product Design

The following should stop being manual operator work:

- discovering the GitHub App installation id
- deciding between private key flow and installation token flow for normal usage
- guessing whether `issue_comment` webhook events were enabled
- guessing which repo SignalForge is currently connected to
- guessing whether the setup is complete enough for a real publish test

These are productization problems, not unavoidable complexity.

## Required Product Capabilities

The next meaningful version of SignalForge adoption should include:

### 1. GitHub App Install Return Flow

After GitHub App installation, SignalForge should be able to detect:

- installation id
- owner / repo target
- granted permissions
- whether required webhook events are enabled

This should remove the need for users to manually discover and paste installation metadata in the normal path.

### 2. Connection State Surface

SignalForge should expose a simple connection surface that answers:

- is GitHub App auth configured?
- which repository is connected?
- is webhook delivery configured?
- can SignalForge publish now?
- can SignalForge receive decision sync now?

This can start as an API-first status object before a full UI exists.

### 3. One-Click Verification

Users should not need to assemble their own validation steps.

SignalForge should provide a first-class verify action that:

- creates a test submission
- runs triage
- verifies publish ability
- reports exactly what succeeded and what failed

The output should be readable by both humans and coding agents.

### 4. Install Wizard State Model

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

For normal teams, SignalForge should bias toward:

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

### Phase B: Add GitHub App Connection Discovery

Deliver:

- GitHub App install callback or polling-based installation discovery
- automatic installation id capture
- repo selection and repo connection status

Success condition:

- users no longer manually hunt for `GITHUB_APP_INSTALLATION_ID` in the normal path

### Phase C: Add Verify Workflow

Deliver:

- one action that submits a test item and verifies publication
- decision sync verification guidance
- clear pass / fail state output

Success condition:

- a small team can tell whether SignalForge is operational without reading internal scripts

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

SignalForge is getting closer to one-click adoption when:

- fewer env vars are required in the normal path
- installation id discovery becomes automatic
- setup failures are visible as structured status instead of hidden docs knowledge
- a new repo can be connected and verified in minutes
- coding agents can perform the install path with fewer repo-specific instructions

## Short Version

SignalForge does not need to make GitHub security boundaries disappear.

It needs to make them feel boring.

That is the real productization standard for small-team adoption.
