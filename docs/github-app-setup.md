# GitHub App Setup

This document explains the intended mature GitHub App experience for FeedbackMesh.

The target operator experience is straightforward:

- install the app
- bring the bot into the repository
- configure once
- let FeedbackMesh publish issues and sync decisions through GitHub

For small teams, this should feel much closer to "turn it on" than "assemble an integration project."

## What The GitHub App Is For

Use the GitHub App path when you want FeedbackMesh to behave like a real product integration instead of a personal-token script.

The GitHub App is the right long-term model because it gives:

- repository-scoped installation
- cleaner auth boundaries
- bot-style operation in the repo
- a more mature issue publication path
- a natural webhook-driven decision loop

## Recommended Operator Flow

For the intended production-like path:

1. deploy or run FeedbackMesh behind HTTPS
2. install the GitHub App into the target repository
3. grant the required repository permissions
4. configure the FeedbackMesh env once
5. let feedback flow into cases and let the bot publish issues

After that, maintainers should mostly operate inside GitHub.

## Minimum Permissions

For issue publication, the GitHub App should have:

- Repository permissions:
  - `Issues: Read and write`
  - `Metadata: Read-only`

For webhook-driven decision sync, also enable:

- Subscribe to events:
  - `Issues`
  - `Issue comment`

## Recommended First Installation Target

Use a dedicated repository first, for example:

- `uDeserve/signalforge-e2e-lab`

Validate the workflow there before moving into a higher-signal production repo.

## Supported App Auth Modes

FeedbackMesh currently supports two GitHub App paths.

### Option A: Static installation token

Use this when you already have an installation token and want the fastest possible validation loop.

```bash
GITHUB_PUBLISHER=app
GITHUB_APP_INSTALLATION_ID=...
GITHUB_APP_INSTALLATION_TOKEN=...
SIGNALFORGE_E2E_REPO=uDeserve/signalforge-e2e-lab
```

### Option B: Full GitHub App auth with explicit installation id

Use this for the standalone E2E script path.

```bash
GITHUB_PUBLISHER=app
GITHUB_APP_ID=...
GITHUB_APP_INSTALLATION_ID=...
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
SIGNALFORGE_E2E_REPO=uDeserve/signalforge-e2e-lab
```

### Option C: Repo-aware JWT auth

Use this when you want FeedbackMesh to discover the installation from the target repository during `doctor`, `verify`, or `GET /setup/status`.

```bash
GITHUB_PUBLISHER=app
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
SIGNALFORGE_E2E_REPO=uDeserve/signalforge-e2e-lab
GITHUB_WEBHOOK_SECRET=...
```

This path can surface:

- discovered installation id
- connected repository
- missing repository permissions
- missing required webhook events

The standalone `node scripts/run_github_app_publish_e2e.mjs` script still expects `GITHUB_APP_INSTALLATION_ID` in JWT mode.

## Fast Verification Commands

Readiness and connection state:

```bash
npm run fm:doctor
node scripts/feedbackmesh_cli.mjs doctor --json
```

Synthetic publish verification:

```bash
node scripts/feedbackmesh_cli.mjs verify
```

Standalone publish E2E:

```bash
node scripts/run_github_app_publish_e2e.mjs
```

Expected result:

- FeedbackMesh creates a case
- FeedbackMesh publishes a real GitHub issue through the App publisher
- the script prints:
  - publisher mode
- target repo
- case id
- issue number
- issue URL

The `verify` command also reports whether decision sync is ready and what the next step is for webhook validation.

## Bot Workflow Expectation

The mature workflow is not just "create issue."

It should also support the maintainer loop:

- the bot publishes the issue
- maintainers respond inside GitHub
- FeedbackMesh receives the webhook
- the case state updates without operators jumping into another tool

That is the real product behavior we are optimizing for.

## Supported Owner Commands

FeedbackMesh currently parses these GitHub issue comment commands:

- `/accept`
- `/reject`
- `/needs-info`
- `/defer`
- `/publish`
- `/delegate <skill-name>`
- `/merge-into <caseId>`

## Webhook URL

For the current webhook service:

- `POST /webhooks/github`

If running locally, expose the listener through a tunnel before registering it with GitHub.

## What Is Already Implemented

- GitHub App publisher interface
- JWT signing
- installation token exchange
- repo-aware installation lookup by target repository
- issue publication through installation token
- staged setup diagnostics for permissions, events, and repo connection
- webhook-driven owner decision sync

## What Has Been Externally Validated

- actual GitHub App credentials
- actual installation on a repo
- actual issue creation on GitHub
- actual webhook delivery from GitHub to FeedbackMesh
- actual owner decision sync through issue comments

## Mature Product Direction

The standard we should keep pushing toward is:

- install the app
- add it to the repo
- configure once
- use FeedbackMesh without ongoing auth babysitting

That is what will feel credible to small teams and independent developers.

## Common Failure Mode

If issue creation works but comment commands do not update FeedbackMesh, check the GitHub App installation payload.

The usual mistake is:

- subscribed events only include `issues`
- `issue_comment` was not enabled

In GitHub App settings, verify:

- Subscribe to events:
  - `Issues`
  - `Issue comment`

If `doctor` or `/setup/status` reports missing permissions or events, treat that output as authoritative over stale setup notes.

You can confirm this in GitHub App Recent Deliveries:

- the installation payload should show both event names
- comment deliveries should appear as `issue_comment`

## Live Endpoint Shape

For a deployed FeedbackMesh instance behind HTTPS, keep SSL verification enabled and point GitHub to:

- Webhook URL: `https://your-domain.example/webhooks/github`

FeedbackMesh expects:

- `POST /webhooks/github`
- `x-github-event`
- `x-hub-signature-256`
