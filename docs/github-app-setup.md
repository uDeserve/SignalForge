# GitHub App Setup

This document explains the intended mature GitHub App experience for SignalForge.

The target operator experience is straightforward:

- install the app
- bring the bot into the repository
- configure once
- let SignalForge publish issues and sync decisions through GitHub

For small teams, this should feel much closer to "turn it on" than "assemble an integration project."

## What The GitHub App Is For

Use the GitHub App path when you want SignalForge to behave like a real product integration instead of a personal-token script.

The GitHub App is the right long-term model because it gives:

- repository-scoped installation
- cleaner auth boundaries
- bot-style operation in the repo
- a more mature issue publication path
- a natural webhook-driven decision loop

## Recommended Operator Flow

For the intended production-like path:

1. deploy or run SignalForge behind HTTPS
2. install the GitHub App into the target repository
3. grant the required repository permissions
4. configure the SignalForge env once
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

SignalForge currently supports two GitHub App paths.

### Option A: Static installation token

Use this when you already have an installation token and want the fastest possible validation loop.

```bash
GITHUB_PUBLISHER=app
GITHUB_APP_INSTALLATION_ID=...
GITHUB_APP_INSTALLATION_TOKEN=...
SIGNALFORGE_E2E_REPO=uDeserve/signalforge-e2e-lab
```

### Option B: Full GitHub App auth

Use this for the intended mature path.

```bash
GITHUB_PUBLISHER=app
GITHUB_APP_ID=...
GITHUB_APP_INSTALLATION_ID=...
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
SIGNALFORGE_E2E_REPO=uDeserve/signalforge-e2e-lab
```

## Fast Verification Command

Run:

```bash
node scripts/run_github_app_publish_e2e.mjs
```

Expected result:

- SignalForge creates a case
- SignalForge publishes a real GitHub issue through the App publisher
- the script prints:
  - publisher mode
  - target repo
  - case id
  - issue number
  - issue URL

## Bot Workflow Expectation

The mature workflow is not just "create issue."

It should also support the maintainer loop:

- the bot publishes the issue
- maintainers respond inside GitHub
- SignalForge receives the webhook
- the case state updates without operators jumping into another tool

That is the real product behavior we are optimizing for.

## Webhook URL

For the current webhook service:

- `POST /webhooks/github`

If running locally, expose the listener through a tunnel before registering it with GitHub.

## What Is Already Implemented

- GitHub App publisher interface
- JWT signing
- installation token exchange
- issue publication through installation token
- webhook-driven owner decision sync

## What Has Been Externally Validated

- actual GitHub App credentials
- actual installation on a repo
- actual issue creation on GitHub
- actual webhook delivery from GitHub to SignalForge
- actual owner decision sync through issue comments

## Mature Product Direction

The standard we should keep pushing toward is:

- install the app
- add it to the repo
- configure once
- use SignalForge without ongoing auth babysitting

That is what will feel credible to small teams and independent developers.

## Common Failure Mode

If issue creation works but comment commands do not update SignalForge, check the GitHub App installation payload.

The usual mistake is:

- subscribed events only include `issues`
- `issue_comment` was not enabled

In GitHub App settings, verify:

- Subscribe to events:
  - `Issues`
  - `Issue comment`

You can confirm this in GitHub App Recent Deliveries:

- the installation payload should show both event names
- comment deliveries should appear as `issue_comment`

## Live Endpoint Shape

For a deployed SignalForge instance behind HTTPS, keep SSL verification enabled and point GitHub to:

- Webhook URL: `https://your-domain.example/webhooks/github`

SignalForge expects:

- `POST /webhooks/github`
- `x-github-event`
- `x-hub-signature-256`
