# Releases

This directory stores repository-local release notes so GitHub releases can be created consistently even without GitHub CLI access.

## Current Planned Releases

- `v0.1.0.md`

## Recommended Release Process

1. ensure `main` contains the intended release commit
2. ensure `CHANGELOG.md` reflects the release
3. create an annotated git tag such as `v0.1.0`
4. push the tag to GitHub
5. create a GitHub Release using the corresponding file in this directory
6. attach any screenshots or future artifacts if needed
