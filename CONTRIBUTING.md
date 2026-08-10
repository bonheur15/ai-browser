# Contributing to AI Browser

## Source-of-truth boundaries

AI Browser has three execution surfaces:

- The Electron main process owns browser state, sessions, credentials, persistence, and
  `WebContentsView` instances.
- The renderer owns presentation, local UI state, and typed commands. It does not access Electron
  APIs or website content directly.
- Preload scripts expose narrow, typed bridges. They do not expose `ipcRenderer` or arbitrary
  process capabilities.

Types and discriminated command/event contracts in `src/shared/` are the cross-process API.
Changes to those contracts must preserve both the main-process implementation and the preload and
renderer consumers.

## File and module structure

Each file should have one primary responsibility. Keep approximately 300 lines as the normal
target. Any source file above 400 lines requires either a focused split or a documented reason
that the code is more coherent together.

Prefer small domain modules over generic utility bags. Keep orchestration in coordinator files and
move parsing, rendering, persistence, and browser lifecycle responsibilities into focused modules.
React components should receive typed props and should not contain large inline business workflows.

Generated output under `dist/`, `dist-electron/`, and `src/renderer/dist/` is never edited by hand.

## TypeScript rules

- Explicit `any` is forbidden.
- `unknown` is allowed only at raw IPC, JSON, Codex, or other untrusted boundaries.
- Boundary values must be narrowed immediately by a named decoder or type guard.
- Do not use `as any`, `as unknown`, or unchecked casts to silence the compiler.
- Do not expose `Record<string, unknown>` in application-domain contracts. Use concrete types or
  the shared recursive JSON types for genuinely dynamic protocol data.
- Do not pass explicit `undefined` for optional properties when an omitted property expresses the
  intended state.
- Keep secrets out of renderer state, logs, snapshots, persisted agent messages, and tool results.
- Throw `Error` instances with useful messages; do not throw strings or arbitrary objects.

The strict compiler settings are intentional. New code must satisfy `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, and `noImplicitOverride`.

## Formatting and linting

Biome is the project formatter, import organizer, and linter. Do not introduce a second formatter
or manually reformat unrelated files while changing product behavior.

```bash
npm run format       # format supported project files
npm run format:check # verify formatting without writing
npm run lint         # run lint rules
npm run check        # CI-safe format, import, and lint check
```

Use `npm run check:write` only when reviewing the resulting diff. Safe automated fixes must still
be inspected, especially around imports and boundary code.

## Validation before handoff

Run the full verification command for every behavior change:

```bash
npm run verify
git diff --check
```

Do not claim repository quality is green if a focused check passes while the full check fails.
Report unrelated pre-existing failures separately and keep changed-file validation explicit.

## Commits and releases

Pull-request titles and direct commits to `main` use Conventional Commits so Release Please can
derive semantic versions and changelog sections. Use `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`,
`test:`, `build:`, `ci:`, `chore:`, or `revert:` with a lowercase subject. Mark breaking changes
with `type!:` or a `BREAKING CHANGE:` footer.

Do not edit release versions or generated changelog sections in ordinary feature pull requests.
Release Please owns those changes through its release pull request. The complete release and
recovery procedure is documented in `docs/RELEASING.md`.

## Refactoring safely

Refactors must preserve public IPC names, browser tool names, persisted state versioning, and
credential handling semantics unless the change explicitly includes a migration. Make one
structural change at a time, run focused tests, then run the full verification suite. Never reset
or overwrite existing user work in the working tree.
