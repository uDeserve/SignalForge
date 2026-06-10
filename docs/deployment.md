# Deployment Guide

This is the current minimal hosted shape for `feedbackmesh.launchhub.icu`.

## Services

Run the two Node services separately:

- API: `node apps/api/src/index.js` on `127.0.0.1:8787`
- GitHub App webhook bridge: `node apps/github-app/src/index.js` on `127.0.0.1:8788`

Required env for the API:

```bash
PORT=8787
SIGNALFORGE_PUBLIC_BASE_URL=https://feedbackmesh.launchhub.icu
GITHUB_APP_SLUG=feedbackmesh
```

Required env for the GitHub App bridge:

```bash
PORT=8788
GITHUB_WEBHOOK_SECRET=...
```

If the API publishes through GitHub App auth, also set `GITHUB_PUBLISHER=app`, `GITHUB_APP_ID`, and `GITHUB_APP_PRIVATE_KEY`.

## Reverse Proxy

Current public routes should terminate at Caddy and stay split by path:

```caddyfile
feedbackmesh.launchhub.icu {
  encode gzip

  handle /webhooks/github {
    reverse_proxy 127.0.0.1:8788
  }

  handle {
    reverse_proxy 127.0.0.1:8787
  }
}
```

This makes these GitHub App settings valid:

- Homepage URL: `https://github.com/uDeserve/FeedbackMesh`
- Setup URL: `https://feedbackmesh.launchhub.icu/setup`
- Webhook URL: `https://feedbackmesh.launchhub.icu/webhooks/github`

## Verify

After deploy, confirm:

```bash
curl https://feedbackmesh.launchhub.icu/health
curl https://feedbackmesh.launchhub.icu/setup/status
curl -I https://feedbackmesh.launchhub.icu/setup
```

The important product check is that GitHub App install redirect now lands on `/setup`, while webhook deliveries still reach `/webhooks/github` on the separate bridge process.
