# Changelog

All notable changes to AI Browser are documented in this file. Releases follow
[Semantic Versioning](https://semver.org/) and this changelog is maintained by Release Please from
[Conventional Commits](https://www.conventionalcommits.org/).

## [0.1.0] - 2026-08-10

### Features

- Added isolated Personal, Work, and ephemeral Private browsing Spaces.
- Added tab, bookmark, site-control, credential-vault, and hibernation workflows.
- Added a local Codex browser agent with bounded tools, approvals, tab locking, and evidence.
- Added browser runtime telemetry, appearance settings, and a refined desktop workspace.

### Security

- Kept Chromium sessions, raw credentials, persistence, and policy enforcement in the main process.
- Added typed preload/IPC boundaries, private-state filtering, and sensitive screenshot masking.

### Engineering

- Added strict TypeScript, Biome formatting and linting, focused Node tests, and production builds.

[0.1.0]: https://github.com/bonheur15/ai-browser/releases/tag/v0.1.0
