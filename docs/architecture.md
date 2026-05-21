# Architecture

High level flow:

```text
User / Product Surface
-> Widget or SDK
-> Intake API
-> Triage Engine
-> FeedbackCase Store
-> GitHub App Bridge
-> GitHub Issues / Discussions
-> Owner Decisions
-> Agent / Skill Bridge
```

The platform should keep raw intake, canonical cases, GitHub publication, and execution separate.
