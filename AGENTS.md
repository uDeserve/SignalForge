# Repository Guidelines

## Project Structure & Module Organization
FeedbackMesh is an npm workspace monorepo. App entrypoints live in `apps/`: `api`, `github-app`, and `web-widget`. Shared logic lives in `packages/`: `adapter`, `core`, `github-bridge`, `mcp-server`, `shared-config`, and `triage`. Tests are usually colocated under each workspace `test/` directory, such as `apps/api/test/api.test.js`. Product docs live in `docs/`, agent-oriented examples in `examples/agent/`, and runnable repo tooling in `scripts/`.

## Build, Test, and Development Commands
Use the root scripts as the supported local workflow:

- `npm run fm:init` creates `.env` from `.env.example` for the FeedbackMesh-branded path.
- `npm run fm:doctor` checks preview, PAT, and GitHub App readiness.
- `npm run fm:start` starts the local API stack.
- `node scripts/feedbackmesh_cli.mjs verify` runs the synthetic setup and publish verification flow.
- `npm test` runs the full Node test suite with `node --test`.

Legacy `sf:*` scripts and `scripts/signalforge_cli.mjs` remain supported for compatibility.

## Coding Style & Naming Conventions
Follow `.editorconfig`: UTF-8, LF endings, final newline, and 2-space indentation. The repo is plain ESM JavaScript; keep public surfaces in `src/index.js` where possible. Prefer descriptive kebab-case filenames such as `setup-status.js`, lowercase package names, and clear exported function names. Keep new user-facing naming on `FeedbackMesh`, but preserve `SignalForge` identifiers where they are intentional compatibility surfaces.

## Testing Guidelines
Write tests with Node's built-in runner and name files `*.test.js` or `*.test.mjs`. Keep tests near the owning app or package, and extend existing patterns like `scripts/signalforge_cli.test.mjs` for CLI coverage. Run `npm test` before opening a PR; if you touch widget or adapter branding, also check the relevant targeted tests first.

## Commit & Pull Request Guidelines
Recent history uses short Conventional Commit prefixes such as `feat:` and `docs:`. Keep subjects imperative and scoped, for example `docs: refresh FeedbackMesh onboarding copy`. PRs should state the user-visible behavior change, link the relevant issue when one exists, and list the commands or flows actually verified. For widget or onboarding UX changes, include screenshots or a short interaction note.

## Security & Configuration Tips
Do not commit real secrets from `.env`. Update `.env.example` when config requirements change, and keep `feedbackmesh.agent.json`, `feedbackmesh.integration.json`, and `docs/quick-start.md` aligned whenever the install flow changes. Hosted examples currently point at `https://sf.launchhub.icu`; treat that as deployment state, not a naming source of truth.
