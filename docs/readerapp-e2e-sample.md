# Readerapp E2E Sample

This document describes the minimal sample path from readerapp-style feedback into FeedbackMesh.

## Goal

Verify:

1. a readerapp-style feedback payload can be ingested
2. triage runs
3. a `FeedbackCase` is produced with issue-ready metadata

## Script

Run:

```bash
node scripts/run_readerapp_feedback_sample.mjs
```

The sample uses:

- reader feedback style payload
- mobile UX complaint
- FeedbackMesh triage engine
- optional DeepSeek analyzer if env is configured

If DeepSeek is unreachable, FeedbackMesh should fall back to heuristic triage automatically.

## What This Does Not Prove

This script is still a repo-local intake check.

It does not prove:

1. hosted setup session creation
2. GitHub App installation on the real example repository
3. first publish into the example repository
4. maintainer decision sync from the example repository back into FeedbackMesh

For that real closure path, use `docs/omni-lingua-agent-first-closure.md`.
