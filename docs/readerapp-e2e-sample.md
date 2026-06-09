# Readerapp E2E Sample

This document describes the minimal sample path from readerapp-style feedback into SignalForge.

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
- SignalForge triage engine
- optional DeepSeek analyzer if env is configured

If DeepSeek is unreachable, FeedbackMesh should fall back to heuristic triage automatically.
