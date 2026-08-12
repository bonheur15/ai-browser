# Changelog

All notable changes to AI Browser are documented in this file. Releases follow
[Semantic Versioning](https://semver.org/) and this changelog is maintained by Release Please from
[Conventional Commits](https://www.conventionalcommits.org/).

## [0.2.0](https://github.com/bonheur15/ai-browser/compare/v0.1.0...v0.2.0) (2026-08-12)


### Features

* add application icon ([39075d4](https://github.com/bonheur15/ai-browser/commit/39075d47638160a66790e3045ca103d104861010))
* add automated release workflow ([d29e576](https://github.com/bonheur15/ai-browser/commit/d29e5760f6a4782f4bb60c8878a59baef16a1ace))
* add browser compatibility and permission utilities ([071f719](https://github.com/bonheur15/ai-browser/commit/071f719977ed7b3ccacb4516bb190008d2363fb0))
* Add browser compatibility tests ([2423fa2](https://github.com/bonheur15/ai-browser/commit/2423fa22010abcc28d3e6fff36eec9b2bce189da))
* add dependency review workflow ([86b0fb2](https://github.com/bonheur15/ai-browser/commit/86b0fb21240c101f9f4a2316a51c6ca62ef1cd54))
* add goal management to agent state store ([5423656](https://github.com/bonheur15/ai-browser/commit/5423656ace85341776b311c735514995e5135af3))
* add goal tracking and activity monitoring to agent contracts ([acffc98](https://github.com/bonheur15/ai-browser/commit/acffc987415efb9c1d52e5d93d6da617c799ebdc))
* add interactiveTopView utility for view stacking logic ([5317e81](https://github.com/bonheur15/ai-browser/commit/5317e8134b6196af917d27367db91acf0ec22c74))
* add IPC command handlers for agent goal management ([901e4af](https://github.com/bonheur15/ai-browser/commit/901e4afb5cb4943c2c93111b7e426c3fdd9a58b6))
* add IPC handler for chrome overlay toggle ([86e7118](https://github.com/bonheur15/ai-browser/commit/86e7118342c5bed338d204af20a5ef117d0bfdd2))
* add memory_search tool to BrowserAgentTools ([b251e44](https://github.com/bonheur15/ai-browser/commit/b251e44c113e1969016049242b5806bec2919b1a))
* add package smoke test workflow ([6ddac9c](https://github.com/bonheur15/ai-browser/commit/6ddac9ca6fc7820ce41ba9dce757ae093233b168))
* add release validation script ([b055416](https://github.com/bonheur15/ai-browser/commit/b055416e01de6e3a5b7cb71c98f8e4d9f0d7eb0f))
* add resizable agent window and goal display styles ([7453fee](https://github.com/bonheur15/ai-browser/commit/7453feef67140c4364b1d7441da2b0ad51102b84))
* add resizable AgentCommandCenter and goal management UI ([1434d74](https://github.com/bonheur15/ai-browser/commit/1434d7459f8886014b0b17833938ac76669eefea))
* add security workflow for CodeQL and npm audit ([df0056b](https://github.com/bonheur15/ai-browser/commit/df0056b3dc322468675ba9cd66516ad1e0d54927))
* add setChromeOverlayActive to BrowserAPI contract ([9fa05d0](https://github.com/bonheur15/ai-browser/commit/9fa05d0ad0cb2c03eda3fc8eaa8cc1003cf181da))
* Add smoke test for packaged Linux app ([09135d4](https://github.com/bonheur15/ai-browser/commit/09135d474bde0b2d54f693475d9d77b73754d3cd))
* add styles for settings workspace and theme support ([485f5a7](https://github.com/bonheur15/ai-browser/commit/485f5a7012ae3ee1c0941995d2ca9af4a0e0ebb1))
* configure session user agent and permission handlers ([e6a7cd1](https://github.com/bonheur15/ai-browser/commit/e6a7cd19ba6a68e01f53a1c47c2e8f2e2920a3e4))
* implement AgentMemoryStore for thread history management ([0079ec2](https://github.com/bonheur15/ai-browser/commit/0079ec20d73f7dc50fcad5a01c167c56843c6624))
* implement goal management and activity tracking in AgentRuntime ([a34752f](https://github.com/bonheur15/ai-browser/commit/a34752fd0ffb2a3d065c08a966dcdd7ebc4d38cc))
* implement settings page and browser interaction shield ([94050c8](https://github.com/bonheur15/ai-browser/commit/94050c8fede47edf0e1e122dc21049f2d5b29e01))
* improve agent tab lock management ([091c91e](https://github.com/bonheur15/ai-browser/commit/091c91e6c3c27703de42e0d9bb22c67e1a5154b8))
* improve agent tab lock management and add releaseAll method ([fce0120](https://github.com/bonheur15/ai-browser/commit/fce0120bd1c473367f6be3edbd5bcb92e24b917c))
* improve AgentCommandCenter dragging and accessibility ([94f6a8d](https://github.com/bonheur15/ai-browser/commit/94f6a8d7e9e85889804e0d0436d01b1b551bbf63))
* integrate AgentMemoryStore into main process ([64d3e1f](https://github.com/bonheur15/ai-browser/commit/64d3e1f674f99577125f16baafe9beebfe8d2eeb))
* Pass chrome (BrowserWindow) instance to main process handler ([7db1bd2](https://github.com/bonheur15/ai-browser/commit/7db1bd233cb8203dcc32d27e323e7f1b27a0f846))
* **preload:** add setChromeOverlayActive to browserAPI ([97e7f93](https://github.com/bonheur15/ai-browser/commit/97e7f933e836fcbbc475bf7f605b3a6d34fc8c2d))


### Bug Fixes

* resolve background color flickering in main window ([fd50b62](https://github.com/bonheur15/ai-browser/commit/fd50b62abfb1fc3504ea2e32596fe1f185cc1af6))


### Refactoring

* apply consistent code formatting to settings-page.tsx ([c5529ea](https://github.com/bonheur15/ai-browser/commit/c5529ea159de87e55d5b7b183e74a6ff0f35eef2))
* improve browser view stacking and interaction handling ([1900be1](https://github.com/bonheur15/ai-browser/commit/1900be18cded0a31e271b179ebfda33fc866f4dc))
* Simplify view stacking logic in BrowserRuntime ([8316520](https://github.com/bonheur15/ai-browser/commit/8316520abc5ae79383d430d85e4c41beff0857f8))


### Documentation

* add contribution guidelines for commits and releases ([3ca460f](https://github.com/bonheur15/ai-browser/commit/3ca460f0a190d49b95bce142985a148db295a52f))
* add Durable Goals feature to README ([2de747c](https://github.com/bonheur15/ai-browser/commit/2de747cde4bbc22369fdc847f67afc0c1d17b83c))
* add release documentation ([f526fcc](https://github.com/bonheur15/ai-browser/commit/f526fcc0f42f749d436b478e2ec11228f0ed8be9))
* initialize CHANGELOG.md for version 0.1.0 ([a296e72](https://github.com/bonheur15/ai-browser/commit/a296e720c0e8e2b95dc4f50067d5995150c3983d))
* update packaging status in project documentation ([7f1dff2](https://github.com/bonheur15/ai-browser/commit/7f1dff2b2eb9a89b5d3c0b15848a15adf96f6f88))
* update README with release process and current limitations ([b0c87f8](https://github.com/bonheur15/ai-browser/commit/b0c87f81f209b22c99461c7b4f174db702058284))


### Continuous Integration

* Add Linux smoke test and improve checksum generation ([cc0e604](https://github.com/bonheur15/ai-browser/commit/cc0e6048c980e6a5511a03765967a17f1d3b2a6e))
* add semantic pull request title validation ([b574729](https://github.com/bonheur15/ai-browser/commit/b57472998ab438560b3b1cc92cfbf3b9f6669900))
* Add smoke test for packaged Linux app ([44fe2f4](https://github.com/bonheur15/ai-browser/commit/44fe2f4e7db2f1156b8badb8c735015f6bb3c63e))

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
