# Case: Mobile Lookup Friction In A Real Reader

This case is derived from real Omni Lingua integration context already present in the repository:

- structured reader feedback reasons around lookup friction, layout discomfort, and weak mobile experience
- FeedbackMesh bridge test payload text describing a mobile lookup popup that is hard to use
- mobile optimization notes focused on popup behavior and touch ergonomics

The point is not that one exact sentence matters.

The point is that a real product tends to receive many small, overlapping complaints around the same interaction surface before the team has one clean engineering object to act on.

## Raw Signal Shape

Representative low-level feedback can look like:

- the lookup popup is hard to tap on mobile
- the popup covers the reading sentence
- the layout feels uncomfortable on a phone
- reading flow breaks when trying to inspect a word

On their own, these reports are easy to dismiss as:

- isolated UX complaints
- wording differences across users
- mobile-specific edge cases

## Why This Is A Good FeedbackMesh Case

This is exactly the kind of product friction that traditional issue flow handles poorly:

- each report sounds slightly different
- some are subjective
- some mention layout, some mention lookup, some mention mobile
- none of them alone is the full engineering story

FeedbackMesh is supposed to collapse those signals into one case such as:

```text
Mobile lookup popup blocks or interrupts reading flow
```

## What FeedbackMesh Should Preserve

A good aggregated case should keep:

- affected surface: reader lookup popup
- platform context: mobile
- user impact: reading flow breaks or becomes awkward
- evidence shape: repeated complaints with overlapping wording
- likely next action: review popup placement, tap targets, and mobile layout behavior

## Why This Matters

For a human team, this case turns vague frustration into a decision-ready UX issue.

For a coding-agent workflow, it creates something much more usable than raw comments:

- a canonical summary
- an affected surface
- a likely reproduction frame
- a scoped UI fix area

## Provenance Note

This case write-up is based on repository-visible Omni Lingua materials:

- the FeedbackMesh bridge service test payload
- the reader feedback reason taxonomy in the frontend
- the mobile optimization documentation

It is intentionally written as a faithful case shape, not as a fabricated claim about exact historical counts.
