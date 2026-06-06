# Releasing

SignalForge release management is intentionally simple for now.

## Release Checklist

Before creating a GitHub release:

- confirm `README.md` reflects the current product position
- confirm `CHANGELOG.md` includes the release entry
- confirm critical docs such as quick start and GitHub App setup are current
- confirm the latest verification notes are linked from `README.md`
- confirm the commit you want to release is already on `main`

## Create The Tag

Example:

```bash
git tag -a v0.1.0 -m "SignalForge v0.1.0"
git push origin v0.1.0
```

## Create The GitHub Release

Use:

- tag: `v0.1.0`
- title: `SignalForge v0.1.0`
- notes source: `docs/releases/v0.1.0.md`

## Release Standard

Each release should explain:

- why the release matters
- what is ready now
- who it is for
- what is still missing

The goal is not hype.

The goal is to make the project feel legible, credible, and easy to evaluate.
