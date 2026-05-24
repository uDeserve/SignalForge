# LLM Triage

SignalForge should use the LLM for first-pass semantic triage of raw user feedback.

The goal is not to let the model decide product truth.

The goal is to turn noisy raw input into decision-ready engineering language.

## Primary Responsibilities

- merge similar raw feedback
- filter low-value or support-like noise
- translate user language into product and engineering language
- summarize impact and evidence
- recommend publishable issue content

## Product Bias

SignalForge should bias toward user feedback as the primary product signal.

- user-reported friction, confusion, blocked flows, awkward interaction, readability problems, and repeated annoyance should be treated as high-value triage inputs
- runtime exceptions are important, but default to supporting evidence unless the failure is clearly severe
- "this feels bad to use" can be more important than "there was an exception" for early-stage product iteration

## Non-Goals

- final authority on whether engineering work should start
- final authority on product roadmap priority
- direct automatic code changes from raw feedback alone

## Input Contract

The triage layer should receive a bounded input object that may include:

- raw feedback submissions
- linked runtime error events
- route, environment, release, and app metadata
- screenshots, logs, or recording references
- existing cluster hints

Example high-level shape:

```json
{
  "submissions": [],
  "runtimeEvents": [],
  "appContext": {},
  "existingClusters": [],
  "policy": {
    "publishBias": "lenient",
    "privacyMode": "strict"
  }
}
```

## Output Contract

The LLM should return structured, bounded output.

Recommended shape:

```json
{
  "normalized_summary": "",
  "problem_type": "bug | ux | feature | support | noise",
  "affected_surface": "",
  "user_impact": "",
  "evidence_used": [],
  "cluster_key": "",
  "cluster_size_estimate": 1,
  "publish_recommendation": "publish | hold",
  "confidence": 0.0,
  "open_questions": [],
  "suggested_labels": [],
  "suggested_next_action": "investigate | fix | reply | ignore"
}
```

## Publish Bias

SignalForge should prefer a lenient publication bias.

That means:

- it is acceptable to publish some noisy issues
- it is not acceptable to require owner approval before every issue
- the strict maintainer decision should happen at execution time

So the LLM should optimize for:

- reducing obvious junk
- merging duplicates
- publishing reasonable decision surfaces

not for minimizing issue count at all costs.

## Fallback Rules

If the LLM is unavailable, SignalForge should fall back to deterministic heuristics.

Fallback should still preserve:

- basic classification
- coarse dedupe fingerprinting
- issue publication eligibility

but the platform should mark the case as:

- `triage_mode: heuristic`
- lower confidence

## Prompting Principle

The model should be prompted like an internal triage analyst, not a support chatbot.

It should answer:

- what is the likely underlying problem
- what user-visible impact exists
- what evidence supports this interpretation
- whether this should become a GitHub decision surface

It should not invent certainty when evidence is weak.
