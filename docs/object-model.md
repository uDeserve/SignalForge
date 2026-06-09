# Object Model

FeedbackMesh centers on `FeedbackCase`, not raw feedback and not GitHub issues.

Core objects:

- `FeedbackSubmission`
- `RuntimeErrorEvent`
- `TriageResult`
- `FeedbackCluster`
- `FeedbackCase`
- `CaseDecision`
- `IssuePublication`
- `AgentDelegation`

The purpose of the model is to turn noisy user signals into decision-ready engineering work.

`FeedbackCase` is the system-of-record object.

It may aggregate:

- raw submissions
- runtime events
- triage outputs
- cluster membership
- publication records
- owner decisions
- agent delegations

## Object Intent

`FeedbackSubmission`

- raw user-originated signal
- may be noisy, emotional, duplicated, or incomplete

`RuntimeErrorEvent`

- machine-originated signal
- useful supporting evidence
- secondary priority compared with user feedback in the default product direction

`TriageResult`

- normalized interpretation of raw signals
- should include confidence and uncertainty
- should not be treated as absolute truth

`FeedbackCluster`

- groups related submissions and runtime evidence
- represents "many users may be describing the same underlying problem"

`FeedbackCase`

- decision-ready engineering object
- can be published to GitHub automatically
- should exist independently from the GitHub issue

`CaseDecision`

- maintainer execution decision
- examples: accept, reject, defer, ask

`IssuePublication`

- downstream publication record
- publication itself is not execution approval
