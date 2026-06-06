# Omni Lingua Case Study

Omni Lingua is the first real dogfooding reference case for SignalForge.

It matters because this is not a toy landing page or a synthetic demo. Omni Lingua is an AI-native reading product with real learner-facing flows, real product friction, and real runtime failure modes. That makes it a credible test bed for the SignalForge thesis.

## Why This Case Matters

Modern coding agents are getting strong at:

- issue to code
- code to PR
- PR to review

The weak point is still upstream:

- real user complaints
- product confusion
- runtime incidents with partial context
- repeated low-signal feedback that never becomes one clean engineering object

Omni Lingua gives SignalForge a realistic source of those signals.

## What Is Integrated Today

The Omni Lingua frontend already bridges the following into SignalForge:

- reader feedback submissions
- AI story reading feedback submissions
- app shell runtime errors
- unhandled promise rejections
- React error boundary failures

This means SignalForge is not only receiving manually written support-style comments. It is also receiving structured context from an existing web product with real routes, reading surfaces, chapters, and interaction hints.

## Integration Shape

The current Omni Lingua bridge configures SignalForge at frontend bootstrap through environment variables:

- `VITE_SIGNALFORGE_ENDPOINT`
- `VITE_SIGNALFORGE_PROJECT_KEY`
- `VITE_SIGNALFORGE_APP_NAME`
- `VITE_SIGNALFORGE_ENVIRONMENT`
- `VITE_SIGNALFORGE_RELEASE`

When enabled, Omni Lingua forwards:

1. explicit reader feedback
2. structured reading context
3. runtime failures from the browser surface

Representative reading context includes:

- route
- book id and title
- chapter id and title
- chapter index
- source type
- feedback type
- rating
- selected reasons
- current product view
- feature and action tags

## Why This Is A Strong SignalForge Reference

Omni Lingua is a better reference case than a blank example app because it has:

- multiple user-facing product surfaces
- reading-specific workflow state
- both subjective feedback and objective runtime failures
- a product team that can actually act on the resulting GitHub issues

That makes it a meaningful example of SignalForge operating in the middle of a real AI-native product loop.

## Minimal Validation Loop

The intended dogfooding loop looks like this:

```text
Omni Lingua user feedback or runtime issue
-> SignalForge submission or runtime event
-> case aggregation and synthesis
-> GitHub issue publication
-> maintainer decision in GitHub
-> follow-up product or engineering action
```

## What This Proves

This case does not yet prove that SignalForge has solved the entire downstream autonomous repair loop.

It does prove something important already:

- SignalForge can sit on top of an existing web app
- the product does not need to be redesigned around SignalForge
- real user-facing context can be preserved into the case layer
- the GitHub-native operating model is compatible with a real product team workflow

## Current Gaps

This dogfooding reference still has room to improve:

- the Omni Lingua bridge is currently a project-local integration layer, not yet a full switch to the published `@signalforge/adapter` path
- a polished public demo flow for this exact integration has not been packaged yet
- a public end-to-end narrative with screenshots or video is still pending

## Why We Are Publishing This Early

The purpose of this case study is not to pretend SignalForge is already fully mature.

The purpose is to show that the project has crossed an important threshold:

SignalForge is no longer just a theory about feedback-to-issue automation.

It is already being used as the feedback and runtime intelligence layer for a real AI-native web product.
