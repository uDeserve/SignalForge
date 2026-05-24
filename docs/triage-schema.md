# Triage Schema

This document defines the practical input and output shape for SignalForge triage.

The schema is intentionally model-agnostic.

It should work for:

- rule-only triage
- LLM-assisted triage
- hybrid pipelines

## Triage Input

```json
{
  "requestId": "triage_123",
  "policy": {
    "publishBias": "lenient",
    "privacyMode": "strict",
    "maxEvidenceItems": 12
  },
  "submissions": [
    {
      "id": "sub_1",
      "submittedAt": "2026-05-22T10:00:00Z",
      "source": "web_widget",
      "reporter": {
        "id": "user_1"
      },
      "appContext": {
        "appName": "readerapp",
        "environment": "production",
        "release": "1.4.2",
        "route": "/reader/book-1/chapter-3",
        "bookId": "book_1",
        "chapterId": "chapter_3"
      },
      "content": {
        "title": "查词弹层挡住正文",
        "body": "手机上点词以后弹层挡住阅读内容，不好继续往下看。",
        "rating": "bad"
      },
      "evidence": {
        "screenshotUrls": [],
        "consoleLogs": [],
        "runtimeErrors": []
      }
    }
  ],
  "runtimeEvents": [],
  "existingClusters": [
    {
      "clusterKey": "mobile-reader-popup-blocks-content",
      "canonicalSummary": "Reader popup blocks content on mobile"
    }
  ]
}
```

## Triage Output

```json
{
  "triageMode": "llm",
  "normalizedSummary": "Mobile reader lookup popup blocks the reading content and interrupts continuation.",
  "problemType": "ux",
  "affectedSurface": "reader mobile lookup popup",
  "userImpact": "Users cannot continue reading smoothly after tapping a word on mobile.",
  "clusterKey": "mobile-reader-popup-blocks-content",
  "clusterAction": "merge_existing",
  "clusterSizeEstimate": 4,
  "evidenceUsed": [
    {
      "kind": "submission",
      "id": "sub_1"
    }
  ],
  "publishRecommendation": "publish",
  "suggestedLabels": [
    "source:user-feedback",
    "type:ux",
    "confidence:medium",
    "cluster:multi-user",
    "decision:pending"
  ],
  "suggestedNextAction": "investigate",
  "confidence": 0.78,
  "openQuestions": [
    "Does this happen on all mobile widths or only small screens?"
  ]
}
```

## Required Output Semantics

- `normalizedSummary`
  A short engineering-readable statement of the likely problem.

- `problemType`
  One of:
  - `bug`
  - `ux`
  - `feature`
  - `support`
  - `noise`

`ux` should be used aggressively for credible end-user friction reports, especially when the user describes:

- blocked continuation
- obscured content
- confusing interaction
- poor mobile experience
- awkward reading flow

- `clusterKey`
  Stable enough for repeated grouping, but not expected to be globally perfect.

- `publishRecommendation`
  One of:
  - `publish`
  - `hold`

- `suggestedNextAction`
  One of:
  - `investigate`
  - `fix`
  - `reply`
  - `ignore`

- `confidence`
  A bounded float between `0` and `1`.

## Heuristic Fallback Shape

If the LLM is unavailable, the fallback output should still conform to the same shape:

```json
{
  "triageMode": "heuristic",
  "normalizedSummary": "Bug report",
  "problemType": "bug",
  "affectedSurface": "",
  "userImpact": "",
  "clusterKey": "route|message",
  "clusterAction": "new_cluster",
  "clusterSizeEstimate": 1,
  "evidenceUsed": [],
  "publishRecommendation": "publish",
  "suggestedLabels": [
    "confidence:low"
  ],
  "suggestedNextAction": "investigate",
  "confidence": 0.42,
  "openQuestions": []
}
```
