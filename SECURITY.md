# Security Policy

## Supported Scope

FeedbackMesh is early-stage software, but responsible disclosure is still expected.

The most security-sensitive areas currently include:

- GitHub App credentials and installation auth
- webhook signature verification and request handling
- any published user feedback content
- deployment configuration and reverse proxy setup

## Reporting A Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Instead, report them privately to the repository maintainers through GitHub security reporting if available, or by direct maintainer contact.

Include:

- affected component
- reproduction steps
- impact assessment
- suggested mitigation if known

## Disclosure Expectations

- we will aim to acknowledge valid reports quickly
- we may ask for reproduction details or environment information
- please avoid public disclosure until a mitigation or coordinated response is ready

## Current Security Posture

FeedbackMesh is actively hardening:

- GitHub App auth handling
- webhook validation and auditability
- public issue publication safety
- privacy controls around user-submitted content
