# Roadmap

SignalForge is moving toward a mature open source product for small web application teams and independent developers.

The north star is clear:

- connect to an existing web app quickly
- reduce setup to near one-click where practical
- make the GitHub App workflow boring, reliable, and production-ready

## Phase 0: Foundations

- lock object model
- lock API contract
- define GitHub flow
- define privacy rules
- define MVP scope

## Phase 1: Core Product Skeleton

- repo skeleton
- intake API
- widget skeleton
- GitHub App skeleton

## Phase 2: Case Formation

- triage
- deduplication
- case publication
- decision parsing

## Phase 3: Operational Depth

- agent delegation bridge
- runtime signal integration
- privacy hardening

Current progress:

- agent delegation bridge: in progress
- runtime signal integration: in progress
- privacy hardening: baseline implemented for public GitHub publication

## Phase 4: Easy Adoption

- ship a reusable feedback widget for existing web apps
- make the adapter path easier to drop into small products
- add first-class Sentry and GlitchTip bridges
- improve operator visibility through webhook activity and audit logging

## Phase 5: Mature GitHub App Experience

- tighten the install-the-app workflow
- reduce manual setup after installation
- harden issue publication and webhook sync
- make bot behavior feel reliable enough for everyday team use

## Phase 6: One-Click Productization

- reusable starter templates for web products
- easier hosted or self-serve setup paths
- sane defaults for small teams
- simpler onboarding flows that feel close to one-click
- GitHub App installation discovery and connection state
- one-click verification for publish and decision sync readiness

## Phase 7: Downstream Execution

- delegated fix execution
- PR creation and review loop
- merge and deploy handoff patterns

## What Success Looks Like

SignalForge feels mature when a small team can:

1. connect an existing app quickly
2. install the GitHub App into the repo
3. let the bot publish and sync decisions reliably
4. operate without needing a second internal triage system

See also:

- `docs/one-click-adoption-plan.md`
