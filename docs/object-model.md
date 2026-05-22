# Object Model

SignalForge centers on `FeedbackCase`, not raw feedback and not GitHub issues.

Core objects:

- `FeedbackSubmission`
- `RuntimeErrorEvent`
- `FeedbackCase`
- `CaseDecision`
- `IssuePublication`
- `AgentDelegation`

The purpose of the model is to turn noisy user signals into decision-ready engineering work.

`FeedbackCase` is the system-of-record object.

It may aggregate:

- raw submissions
- runtime events
- publication records
- owner decisions
- agent delegations
