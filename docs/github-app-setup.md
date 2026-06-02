# GitHub App Setup

This document explains how to run SignalForge with the GitHub App publisher.

## Goal

Use GitHub App auth instead of a personal token for issue publication.

SignalForge supports two GitHub App paths:

- static installation token for controlled testing
- full JWT -> installation token exchange for production-like validation

## Minimum Permissions

For issue publication, the GitHub App should have:

- Repository permissions:
  - `Issues: Read and write`
  - `Metadata: Read-only`

For webhook-driven decision sync, also enable:

- Subscribe to events:
  - `Issues`
  - `Issue comment`

## Recommended Test Repo

Use a dedicated repo first, for example:

- `uDeserve/signalforge-e2e-lab`

Do not start on the main project repo.

## Required Env

### Option A: Static installation token

Use this when you already have an installation token and only want to validate the publisher boundary.

```bash
GITHUB_PUBLISHER=app
GITHUB_APP_INSTALLATION_ID=...
GITHUB_APP_INSTALLATION_TOKEN=...
SIGNALFORGE_E2E_REPO=uDeserve/signalforge-e2e-lab
```

### Option B: Full GitHub App auth

Use this for the intended production-like path.

```bash
GITHUB_PUBLISHER=app
GITHUB_APP_ID=...
GITHUB_APP_INSTALLATION_ID=...
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
SIGNALFORGE_E2E_REPO=uDeserve/signalforge-e2e-lab
```

## E2E Command

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

## Webhook URL

For the current webhook service:

- `POST /webhooks/github`

If running locally, expose the GitHub app listener through a tunnel before registering it with GitHub.

## Current Boundary

What is already implemented:

- GitHub App publisher interface
- JWT signing
- installation token exchange
- issue publication through installation token

What has now been externally validated:

- actual GitHub App credentials
- actual installation on a repo
- actual issue creation on GitHub
- actual webhook delivery from GitHub to SignalForge
- actual owner decision sync through issue comments

## Verified Production-Like Flow

The following path has been confirmed against a live deployment:

```text
SignalForge case
-> GitHub App publisher
-> real GitHub issue
-> maintainer comment command
-> GitHub webhook
-> SignalForge decision record
-> case status update
```

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
