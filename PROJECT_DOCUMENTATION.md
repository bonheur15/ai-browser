# AI Browser — Complete Project Documentation

**Audit date:** 2026-08-10  
**Project version:** 0.1.0  
**Repository branch:** main  
**Current implementation status:** working foundation with a functional Electron browser shell, isolated Spaces, persistent local state, a local Codex app-server adapter, and an initial browser-agent surface.

This document is the current source of truth for the project as it exists in the repository. It describes the product intent, the code that is actually implemented, the storage and security boundaries, the commands and interfaces, the verified checks, and the features that are still missing or only partially implemented.

The project plan is broader than the current code. Items labeled **planned**, **partial**, **missing**, or **known issue** have not been silently treated as complete.

## 1. Product summary

AI Browser is a local-first Electron browser designed around isolated browser identities called **Spaces**. It combines a custom frameless browser interface with a global AI workspace. The browser is intended for people who need separate personal, work, research, and account contexts while retaining an understandable relationship between tabs, sessions, credentials, and AI actions.

The product has two layers:

- **Browser foundation:** a Chromium browser surface rendered through Electron WebContentsView, with custom React chrome, multiple tabs, isolated sessions, bookmarks, site data controls, a local credential vault, and private Spaces.
- **AI foundation:** a global right-side agent dock backed by a locally installed Codex app-server process. The agent can inspect and operate browser tabs through bounded browser tools while the main process remains the authority for policy, sessions, credentials, and browser mutations.

The project deliberately does not yet provide shell access, filesystem access, arbitrary desktop automation, extensions, cloud sync, history, downloads management, or a full permissions UI.

## 2. Current status at a glance

| Area | Current state | Notes |
| --- | --- | --- |
| Electron shell | Implemented | Frameless window, custom controls, dark theme, React chrome. |
| Browser rendering | Implemented | Websites render in WebContentsView, not in React or an iframe. |
| Unified top chrome | Implemented | One compact command dock combines navigation, search, Agent, Vault, site controls, and window controls. |
| Persistent Spaces | Implemented | Personal and Work are created on first run and use isolated Chromium partitions. |
| Private Spaces | Implemented | Non-persistent session partition and in-memory application state. |
| Multiple tabs | Implemented | Tabs are global metadata objects permanently associated with a Space. |
| Cross-Space tab access | Implemented | All Spaces view and direct activation across Spaces are supported. |
| Tab clone/move | Implemented | A new URL-based tab is created; cookies and session state are not transferred. |
| Explicit hibernation | Implemented, with limitation | Renderer is destroyed and recreated from the URL; in-page renderer state is not preserved. |
| URL-or-Google navigation | Implemented | HTTP(S) URLs navigate directly; other text uses Google Search. |
| Login/session persistence | Implemented at Chromium-session level | Cookies, local storage, cache, IndexedDB, service workers, and permissions are partitioned by Space. |
| Credential save prompt | Implemented | Main-process-only password handling with encrypted vault storage when OS encryption is available. |
| Credential autofill | Implemented | Explicit UI/agent fill sends secrets directly from main to browser preload. |
| Site dossier/clearing | Partial | Inspection and clear/forget commands exist; UI confirmation and complete storage reporting are incomplete. |
| Bookmarks | Implemented | Bookmarks belong to Spaces and appear in the Vault drawer. |
| Codex connection | Implemented | Local codex app-server --stdio, request correlation, model discovery, streaming deltas. |
| Default model | Implemented | gpt-5.6-luna is the initial default and there is no silent fallback. |
| AI browser tools | Implemented | Page reading, screenshots, navigation, tab management, interaction, and credential operations. |
| Agent modes | Implemented | Full, Guided, and Observe policy modes are enforced in the main process. |
| Agent policy controls | Partial | Scope controls and slash commands exist; diagnostics and some UI controls are incomplete. |
| Agent thread persistence | Implemented, with gaps | Persistent metadata/transcript/action state is stored; private threads are ephemeral. |
| Evidence thumbnails | Implemented, with gaps | Screenshots are downscaled and retained per thread; pin/delete and disk quotas are missing. |
| Browser fixture tests | Missing | There are no local HTTP fixture workflows for login, forms, prompt injection, or redaction. |
| Electron end-to-end tests | Missing | Current tests do not launch a real BrowserWindow and drive real WebContentsViews. |
| Packaging/distribution | Implemented foundation | GitHub Actions and electron-builder create Windows, macOS, and Linux packages with checksums, SBOM, provenance, and changelog automation. Signing requires repository secrets; auto-update and store publishing are not implemented. |

## 3. Design principles and non-goals

### 3.1 Principles

- **Spaces are browser identities.** A Space is not just a color label; it owns a Chromium session partition and therefore owns login state.
- **The main process is authoritative.** React displays state and sends typed commands. It does not own cookies, passwords, sessions, or browser views.
- **Website content is untrusted.** Page text, labels, screenshots, and DOM-derived descriptions are data supplied by a website and must not be allowed to change agent policy.
- **Credentials are explicit.** Saving is prompted. Autofill is selected by the user or by an allowed agent action. Passwords never enter React state or the model transcript.
- **The browser remains useful without AI.** Codex is lazy-loaded. Missing Codex, missing authentication, or unavailable model discovery should not prevent ordinary browsing.
- **Private means ephemeral.** Private Spaces and private agent threads are excluded from disk persistence.
- **Local-first storage.** Browser metadata, encrypted credentials, agent transcripts, and selected evidence are stored locally under Electron’s user-data directory.

### 3.2 Current non-goals

The following are intentionally outside the current foundation milestone:

- Cloud synchronization.
- History UI and history search.
- Downloads manager.
- Browser extensions.
- Shell, filesystem, code execution, MCP, or arbitrary OS automation.
- Native browser password-manager import/export.
- Full browser permission management.
- Multi-device identity or account synchronization.
- Encrypted vault export/import.
- Automatic tab hibernation.
- Automatic AI actions without a visible agent run.

## 4. Quick start

### 4.1 Requirements

- Node.js and npm. The repository contains package-lock.json, so npm is the reproducible package-manager path.
- Electron dependencies installed with npm install.
- A graphical Linux, macOS, or Windows environment for Electron.
- An installed and authenticated codex executable for AI features.
- A local model list that includes gpt-5.6-luna if that model is to be used.

Bun can run the npm scripts, which is why commands such as bun run start work in the current workspace. There is no bun.lockb or bun.lock checked in, so dependency reproducibility currently follows npm’s lockfile.

### 4.2 Install

~~~bash
npm install
~~~

### 4.3 Run the production-style local build

~~~bash
npm run build
npm start
~~~

npm start launches Electron against the built renderer in dist/ and the compiled main process in dist-electron/.

The start script intentionally removes ELECTRON_RUN_AS_NODE:

~~~bash
env -u ELECTRON_RUN_AS_NODE electron .
~~~

This matters on environments where Electron is otherwise started in Node compatibility mode.

### 4.4 Run development mode

~~~bash
npm run dev
~~~

Development mode starts Vite on 127.0.0.1:5173, compiles the Electron process, waits for Vite, and launches Electron with --dev. The renderer uses Vite only in this mode.

The Vite server is deliberately bound to IPv4 loopback. If port 5173 is already occupied, the development script does not automatically choose another port because the Electron wait/load URL is fixed. Stop the conflicting process or update the development configuration consistently.

### 4.5 Run quality checks

~~~bash
npm run typecheck
npm run build
npm test
git diff --check
~~~

The equivalent Bun commands are valid where Bun is installed, for example bun run typecheck and bun test, but npm is the documented baseline.

### 4.6 AI prerequisites

The application starts the Codex process lazily when an agent thread needs it. The expected local command is:

~~~bash
codex app-server --stdio
~~~

The application does not accept an API key fallback in this milestone. Codex authentication is expected to already exist in the user’s local Codex installation. If the executable is missing, authentication is unavailable, or the model list does not contain the requested model, the Agent dock should show a clear connection/model state rather than silently switching models.

## 5. Repository map

~~~text
ai-browser/
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.electron.json
├── vite.config.mts
├── src/
│   ├── main.ts
│   ├── preload.ts
│   ├── ai/
│   │   ├── agent-evidence-store.ts
│   │   ├── agent-policy.ts
│   │   ├── agent-runtime.ts
│   │   ├── agent-state-store.ts
│   │   ├── browser-agent-tools.ts
│   │   ├── codex-app-server-client.ts
│   │   └── codex-protocol.ts
│   ├── main/
│   │   ├── agent-ipc.ts
│   │   ├── browser-preload.ts
│   │   ├── browser-runtime.ts
│   │   ├── ipc.ts
│   │   ├── secret-vault.ts
│   │   ├── space-session-manager.ts
│   │   └── state-store.ts
│   ├── renderer/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── styles.css
│   ├── shared/
│   │   ├── agent-contracts.ts
│   │   └── contracts.ts
│   └── types/
│       ├── vite-env.d.ts
│       └── window.d.ts
└── tests/
    ├── agent-foundation.test.mjs
    ├── codex-client.test.mjs
    └── state-store.test.mjs
~~~

### 5.1 Main-process files

| File | Responsibility |
| --- | --- |
| src/main.ts | Creates the frameless window, initializes stores and runtimes, loads the renderer, forwards events, and flushes state on shutdown. |
| src/main/browser-runtime.ts | Owns tabs, WebContentsView instances, view attachment/detachment, navigation, browser events, page-agent requests, screenshots, credentials, and tab lifecycle. |
| src/main/space-session-manager.ts | Maps Spaces to persistent or in-memory Electron sessions and applies permission defaults. |
| src/main/state-store.ts | Stores non-secret browser state, manages snapshots, private-state filtering, debounced writes, and atomic replacement. |
| src/main/secret-vault.ts | Encrypts credential payloads with Electron safeStorage and keeps raw passwords in main-process memory only. |
| src/main/ipc.ts | Exposes the typed browser bridge and window-control handlers. |
| src/main/agent-ipc.ts | Exposes the typed agent bridge and viewport/event paths for the React chrome. |
| src/main/browser-preload.ts | Runs inside website views, detects login candidates, provides bounded page context, performs agent page actions, and marks sensitive screenshot rectangles. |

### 5.2 AI files

| File | Responsibility |
| --- | --- |
| src/ai/codex-protocol.ts | Shared JSON-RPC-shaped protocol types and basic wire-object validation. |
| src/ai/codex-app-server-client.ts | Spawns Codex, correlates requests and responses, discovers models, streams notifications, and routes dynamic tools. |
| src/ai/agent-policy.ts | Enforces mode, Space, tab, origin, action-class, Vault, private-Space, and tab-count limits. |
| src/ai/browser-agent-tools.ts | Defines and executes the browser dynamic-tool namespace, validates arguments, creates traces, requests approvals, and formats compact tool results. |
| src/ai/agent-runtime.ts | Owns threads, turns, messages, approvals, policy/model commands, Codex events, tool callbacks, stop/pause behavior, and agent snapshots. |
| src/ai/agent-state-store.ts | Persists thread metadata, transcript, action summaries, active thread, policies, and global defaults. |
| src/ai/agent-evidence-store.ts | Stores downscaled screenshot thumbnails and evidence metadata. |

### 5.3 Renderer and shared files

| File | Responsibility |
| --- | --- |
| src/renderer/main.tsx | React application, Space rail, unified command dock, tab deck, Vault/site drawers, Agent dock, window controls, subscriptions, and viewport measurement. |
| src/renderer/styles.css | Dark floaty command-canvas visual system and responsive layout. |
| src/renderer/index.html | Renderer entry document and CSP. |
| src/preload.ts | Secure bridge preload for the React chrome. It exposes typed APIs but not raw ipcRenderer. |
| src/shared/contracts.ts | Browser Spaces, tabs, bookmarks, sites, credentials, snapshots, commands, events, and page request contracts. |
| src/shared/agent-contracts.ts | Agent policies, modes, threads, messages, traces, approvals, evidence, snapshots, commands, events, and page context contracts. |

## 6. Process and rendering architecture

The application has three distinct execution surfaces:

~~~text
┌─────────────────────────────────────────────────────────────┐
│ Electron main process                                       │
│                                                             │
│  AppStateStore   BrowserRuntime   SessionManager   Vault     │
│                         │                                   │
│                         ├── WebContentsView per tab         │
│                         │       └── browser-preload.ts      │
│                         │                                   │
│  AgentRuntime ─── AgentPolicy ─── BrowserAgentTools         │
│       │                                                     │
│       └── CodexAppServerClient ── codex app-server --stdio  │
└───────────────┬─────────────────────────────────────────────┘
                │ typed IPC bridges
┌───────────────▼─────────────────────────────────────────────┐
│ React chrome renderer                                       │
│ Space rail · unified dock · tab deck · drawers · Agent dock │
└─────────────────────────────────────────────────────────────┘
~~~

### 6.1 React chrome

The React application is the browser’s custom frame. It contains no website page content. It handles navigation controls, tab cards, Spaces, Vault/site panels, agent conversation, approvals, and window buttons.

### 6.2 Website views

Each tab is an Electron WebContentsView. Website pages are not rendered inside React and are not embedded with iframes. Websites retain normal browser behavior, cookies, navigation, and Chromium isolation. The active view is attached to the BrowserWindow at the browser viewport bounds. Inactive views remain managed by the runtime but are detached from the visible layout.

Every website view is configured with:

~~~ts
{
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  preload: browserPreloadPath,
}
~~~

The view uses the Electron session belonging to the tab’s Space.

### 6.3 Typed bridges

The React preload exposes window.browserAPI and window.agentAPI. Neither bridge exposes raw ipcRenderer. Website preloads use a separate internal channel and do not receive the React application’s API.

### 6.4 Browser viewport layout

React measures the available browser surface and calls setBrowserViewport. The main process positions the active WebContentsView below the unified chrome, beside the Space rail, and beside the Agent dock when it is open. This prevents browser content from being covered by the custom UI.

## 7. Browser product model

### 7.1 Spaces

A Space represents a persistent browser identity. Persistent Spaces are backed by Chromium partitions:

~~~text
persist:space-personal
persist:space-work
~~~

The exact partition is derived from the Space ID as persist:space-[space.id].

The partition isolates:

- Cookies.
- Local storage.
- IndexedDB.
- Cache.
- Service workers.
- Website permission state.
- Login/session state.

The default first-run Spaces are:

| ID | Name | Kind | Initial content |
| --- | --- | --- | --- |
| personal | Personal | persistent | Google tab. |
| work | Work | persistent | No initial tab. |

The first-run defaults are defined in src/main/state-store.ts.

### 7.2 Private Spaces

Private Spaces use a non-persistent Electron partition derived as private-[space.id]. Private Space metadata, tabs, bookmarks, site records, credentials, and agent threads are removed from disk persistence.

Private behavior currently depends on application lifecycle cleanup. The session manager drops the session reference when a private Space is forgotten, but there is not yet a dedicated explicit session-destruction API or private-data wiping workflow.

### 7.3 Tabs

A tab is globally managed metadata with permanent Space affinity:

~~~ts
type Tab = {
  id: string;
  spaceId: string;
  title: string;
  url: string;
  faviconUrl?: string;
  status: "loading" | "loaded" | "hibernated";
  createdAt: string;
  lastActiveAt: string;
};
~~~

Tabs can be viewed through:

- **All Spaces**, which shows the global deck.
- A selected persistent Space.
- A selected private Space while it exists.

Activating a tab from another Space changes the active context to that Space. Creating a new tab without an explicit Space uses the currently selected destination Space.

### 7.4 Clone and move semantics

Cloning or moving a tab creates a new tab using the current URL. The source tab’s cookies, local storage, login state, and renderer memory are not transferred.

- **Clone:** creates the new tab and leaves the source tab open.
- **Move:** creates the new tab and closes the source tab.

The destination Space’s session decides whether the URL is already authenticated.

### 7.5 Hibernation

Hibernation explicitly releases the tab’s renderer by destroying its WebContentsView. The tab metadata and URL remain. Restoring creates a fresh view in the same Space and navigates to the saved URL.

This preserves Space identity and URL but does not preserve in-page JavaScript state, scroll position, unsaved form content, or a renderer’s in-memory page state. Automatic hibernation is not implemented.

### 7.6 Navigation

The command field accepts either a URL or search text:

- http://... and https://... navigate directly.
- All other non-empty input navigates to a Google search URL.
- An empty tab loads a dark custom new-tab surface.

Window-open behavior is restricted:

- HTTP(S) popups become new tabs in the opener’s Space.
- mailto:, tel:, and sms: are sent to shell.openExternal.
- Arbitrary protocols are rejected.

### 7.7 Site records

Navigation creates or updates a Space-owned site record containing origin, hostname, last visit, credential count, bookmark state, cookie count, an approximate storage flag, and the “never save credentials” preference.

Site records are application metadata. They are not a replacement for Chromium’s underlying website storage.

## 8. Interface and interaction model

The interface follows a “floaty command canvas” direction rather than a conventional full-width browser toolbar.

### 8.1 Unified command dock

The current top chrome is one unified surface containing:

- Product mark and active context.
- Back, forward, reload/stop.
- URL-or-Google search field.
- Current Space indicator.
- Agent button.
- Vault button.
- Site dossier button.
- Bookmark action.
- New tab action.
- Minimize, maximize/restore, and close controls.

This replaced the earlier separate navbar/frame arrangement so the browser has one top-level control surface.

### 8.2 Space rail

The left rail contains:

- All Spaces.
- Persistent Spaces.
- Private Spaces while alive.
- Tab counts.
- New Space.
- New Private Space.
- Per-Space context actions for rename and delete.

The current UI does not yet expose the existing space.updateAppearance command, so color/icon editing is available in the backend contract but not in the finished UI.

### 8.3 Global tab deck

Tab cards show:

- Favicon when available.
- Title.
- Hostname.
- Space badge/color.
- Loading state.
- Hibernated state.
- Close action.
- Clone/move/hibernate actions.

Current deck behavior is click-based. Drag reordering and drag-to-Space operations are not implemented even though they were part of the broader product plan.

### 8.4 Vault drawer

The Vault drawer shows:

- Credential summaries containing site, username, Space, and credential ID.
- Explicit Fill actions.
- Remove credential actions.
- Space bookmarks.
- Known sites.

Raw passwords never enter the drawer’s React state.

### 8.5 Site drawer

The site drawer shows the selected origin, hostname, cookie count, approximate storage presence, credential count, bookmark status, and actions to:

- Clear website data.
- Remove saved logins.
- Forget site metadata, optionally clearing data and removing credentials.

The current buttons dispatch immediately. A confirmation dialog explaining that clearing site data may log the user out is still missing.

### 8.6 Agent dock

The Agent dock is an expandable right-side floating panel. It contains:

- Thread list and New thread.
- Connection status.
- Model picker.
- Full, Guided, and Observe mode controls.
- Space/tab/origin/action/Vault/private/tab-count policy controls.
- Page-sharing status.
- Current target Space and tab.
- Transcript.
- Approval cards.
- Recent action timeline.
- Pause, Resume, and Stop controls when applicable.
- Composer.
- Screenshot evidence thumbnails.

The browser viewport is narrowed while the Agent dock is open so the active website remains visible.

### 8.7 Current shortcuts

- Ctrl/Cmd+L: focus the command field.
- Ctrl/Cmd+Enter in the Agent composer: send the message.
- Ctrl/Cmd+Shift+L: the intended credential-fill shortcut is represented in the product plan, but a dedicated global keyboard handler is not yet implemented.

## 9. Browser state, persistence, and storage

### 9.1 User-data paths

The application stores data below Electron’s app.getPath("userData"):

| Path | Contents | Secret? | Private data? |
| --- | --- | --- | --- |
| app-state.json | Spaces, tabs, bookmarks, sites, scope, active tab, drawer state. | No | Filtered out. |
| vault.enc | Encrypted credential payload. | Yes | Private credentials are never saved. |
| agent-state.json | Persistent thread metadata, transcript, action traces, policies, and defaults. | Contains user/page-derived text; not a password vault | Private threads are filtered out. |
| agent-evidence/ | Downscaled screenshot thumbnails and evidence index. | May contain page imagery | Private evidence is not persisted. |
| Chromium session directories | Cookies, storage, cache, service workers, permissions for persistent partitions. | Contains session data | Private partitions are non-persistent. |

### 9.2 Browser state schema

The browser state is versioned as version 1 and includes:

~~~ts
{
  version: 1,
  spaces: Space[],
  tabs: Tab[],
  bookmarks: Bookmark[],
  sites: SiteRecord[],
  scope: "all" | string,
  activeSpaceId: string,
  activeTabId: string | null,
  drawer: "vault" | "site" | null,
  selectedSiteId: string | null
}
~~~

Private objects can exist in memory during a run, but AppStateStore.writeNow removes private Spaces and their dependent tabs, bookmarks, and sites before writing.

### 9.3 Agent state schema

The agent state is separately versioned as version 1. It stores:

- Thread metadata.
- Persistent Codex thread ID for resumption.
- User, assistant, tool, status, approval, and error messages.
- Compact action summaries.
- Active thread ID.
- Per-thread policy and model settings.
- Global policy defaults.

The renderer snapshot does not include Codex thread IDs or ephemeral flags. Private/ephemeral threads and their messages/actions are filtered out before persistence.

On startup, threads that were starting, running, or waiting-for-approval are restored as paused because there is no safe assumption that the previous turn is still active.

### 9.4 Atomic writes

Both browser and agent state stores debounce writes and write a temporary file before renaming it over the target. This reduces the chance of leaving a partially written JSON file after a normal interruption.

Current limitations:

- There is no fsync or durable journal.
- There is no rotating backup file.
- The version field exists, but there is no full migration framework.
- Validation is permissive; malformed but array-shaped content can be accepted.
- Write failures are logged and the process continues with in-memory state.

### 9.5 Credential vault

The vault uses Electron safeStorage to encrypt a JSON payload. Each credential contains an origin, Space ID, username, password, and timestamps. The encrypted document is base64-encoded in vault.enc.

Rules:

- If safeStorage.isEncryptionAvailable() is false, save and autofill are disabled.
- On Linux, a basic_text backend is treated as unavailable.
- Raw passwords are only read by the main process.
- Credential summaries omit password values.
- Passwords are never placed in AppSnapshot, AgentSnapshot, events, traces, or React state.
- Private Spaces never save credentials.
- Removing credentials does not clear website session data unless the user separately requests site clearing.

Current limitations:

- JavaScript strings are not explicitly zeroized in memory.
- Credentials remain in a main-process Map for the process lifetime after loading.
- There is no vault lock timeout, key rotation, secure export/import, or user-facing vault recovery flow.
- There is no native password-manager migration.
- The save candidate is held in memory for the pending prompt window, currently bounded by a short timeout.

### 9.6 Evidence storage

Agent screenshots are captured in memory, sent to Codex, and then downscaled for local evidence storage. Persisted thumbnails are PNGs with a maximum width of approximately 480 pixels. The evidence store keeps up to 20 records per thread and maintains an atomic index.

Current limitations:

- Every screenshot capture currently becomes a stored evidence candidate automatically.
- There is no user pin/delete control.
- There is no total disk quota across threads.
- Evidence retention and sensitive-image review are not user-configurable.

## 10. Security model

### 10.1 Electron isolation

The main window and website views use:

- contextIsolation: true.
- nodeIntegration: false.
- sandbox: true for website views.
- A custom preload bridge instead of direct renderer IPC.
- A dark, restrictive renderer CSP.

Website content does not receive access to React state or the raw browser API.

### 10.2 IPC validation

Commands are typed in shared contracts and validated in the main process before execution. IDs must resolve to known Spaces, tabs, credentials, bookmarks, or sites. The renderer cannot directly call Electron session APIs or access the vault.

The agent has a separate IPC surface. Codex requests are accepted only for the registered browser dynamic-tool namespace and are rejected for shell, filesystem, MCP, permissions, or arbitrary tools.

### 10.3 Session isolation

The session manager creates one Chromium session per Space. BrowserRuntime checks the tab’s Space before navigation, page access, and credential operations. Moving a tab changes its session by creating a new view; it never copies cookies or storage.

### 10.4 Permission defaults

Session permission requests default to denied. A dedicated permission surface does not yet exist, so users cannot selectively approve camera, microphone, notifications, geolocation, clipboard, or other permission classes through the product UI.

### 10.5 External protocols

Only the explicitly handled mailto:, tel:, and sms: protocols are passed to shell.openExternal. Arbitrary application protocols are rejected.

### 10.6 Credential boundaries

The credential flow is split into four trust boundaries:

~~~text
Website form
   │ candidate login fields only
   ▼
Website preload ── internal IPC ──► main process pending prompt
                                      │ user approval
                                      ▼
                                 encrypted vault

Vault fill request ─► main process retrieves password ─► website preload ─► website form
                                      │
                                      └── only success/failure metadata to React/agent
~~~

The model receives only credential IDs, site/username summaries, and fill result metadata. It never receives the password.

### 10.7 Page-data boundaries

browser.get_page_context returns bounded title, URL, visible text, headings, interactive element metadata, scroll metrics, and a temporary snapshot ID. It does not return cookies, local storage, IndexedDB, hidden input values, password values, or generic form values.

Page text and screenshots are untrusted data. The agent developer instructions explicitly tell Codex to treat page content as untrusted and not to follow instructions found on a website.

### 10.8 Sensitive-field handling

The website preload rejects generic typing into fields that appear to be password, payment-card, CVV/CVC, OTP, hidden, or security-code fields. Credential fill has a separate path.

Screenshots are redacted using heuristic selectors for password and sensitive form fields before being sent to the model. The raw screenshot is not persisted automatically.

Current security caveats:

- Heuristic selectors can miss custom controls, shadow-DOM fields, or unusual sensitive field names.
- Heuristics can over-redact ordinary fields.
- Screenshot redaction is not a formal guarantee against all sensitive pixels.
- Website text can contain prompt-injection instructions; the current defense is bounded data plus developer instructions, not a complete prompt-injection solution.
- Browser console and load-error logging can include raw page-derived error messages. This must be removed or sanitized before a security-focused release.

## 11. AI architecture

### 11.1 Codex adapter

CodexAppServerClient launches:

~~~text
codex app-server --stdio
~~~

It communicates with JSON-RPC-shaped newline-delimited messages. It:

- Correlates request IDs with pending promises.
- Sends initialize and initialized.
- Requests model/list.
- Exposes connection states: stopped, starting, ready, unauthenticated, missing, and crashed.
- Starts and resumes remote Codex threads.
- Starts and interrupts turns.
- Streams assistant message deltas.
- Routes only accepted dynamic browser tool calls.
- Rejects oversized lines/buffers and malformed JSON responses.
- Removes ELECTRON_RUN_AS_NODE from the child environment.
- Discards Codex stderr in the current implementation to avoid logging user/page content.

The dynamic namespace currently uses ai_browser. The original product plan called it browser, but the local Codex server rejected the reserved browser namespace, so the implementation uses ai_browser as an adapter compatibility decision.

### 11.2 Codex thread lifecycle

Persistent threads store their remote Codex thread ID and use thread/resume when possible. New threads default to the currently open persistent workspace. If the active browser context is a private Space, the thread is marked ephemeral and is not written to disk.

Thread commands include:

- Create.
- Select.
- Rename.
- Delete.
- Send message.
- Pause.
- Resume.
- Stop.
- Update policy.
- Update model/reasoning effort.
- Respond to approval.

AI initialization is lazy so normal browser startup does not require Codex to be installed or authenticated.

### 11.3 Models

The default model is:

~~~text
gpt-5.6-luna
~~~

The model picker is populated from Codex model/list. The client requests no provider fallback. If Luna is unavailable, the UI should show the unavailable state rather than choosing another model automatically.

### 11.4 Agent modes

| Mode | Reads page | Browser mutations | High-impact approvals |
| --- | --- | --- | --- |
| Observe | Yes | No | Not applicable. |
| Guided | Yes | Yes | Approval before credential fill, submit, external side effect, destructive actions, and elevated interaction labels. |
| Full | Yes | Yes | No per-action approval after the user enables Full, subject to hard policy scope. |

Stop is intended to interrupt the Codex turn and prevent pending approvals from proceeding. Pausing interrupts at a safe boundary and leaves the thread resumable.

### 11.5 Agent policy

The policy engine enforces:

- Agent mode.
- Allowed Space IDs.
- Allowed tab IDs.
- Allowed origins.
- Allowed action classes.
- Vault access.
- Private-Space access.
- Maximum tab count.

Origins support exact origins/hostnames and explicit *.example.com patterns. A broad unrestricted wildcard is not a valid intended policy, although the current validator should be tightened to reject "*" explicitly rather than merely allowing it to match nothing.

The model cannot broaden policy. Policy changes must come through renderer commands and are checked in the main process.

### 11.6 Scope commands

The Agent composer supports local hard-scope commands such as:

~~~text
/scope spaces=personal,work tabs=tab_123 origins=linkedin.com,docs.google.com
/scope spaces Personal,Work
/allow credential-fill,submit
/deny close-tab
~~~

The parser supports both key/value and token-separated forms for common scope fields. Slash commands are consumed locally and do not become model messages. Ordinary natural-language instructions remain task guidance rather than hard policy.

### 11.7 Action classes

| Action class | Meaning | Examples |
| --- | --- | --- |
| read | Read-only browser information. | List tabs, list Spaces, page context, screenshot. |
| navigate | Change page URL or browser history position. | Navigate, back, forward, reload. |
| tab-management | Create, activate, clone, or move tabs. | Create tab, activate tab. |
| page-interaction | Interact with visible page controls without the separate credential/submit category. | Scroll, click, type into non-secret field, select, press key. |
| credential-fill | Fill a saved credential through the Vault path. | Fill username/password. |
| form-submit | Submit a page form. | Submit form. |
| external-side-effect | Potentially communicate or change external state. | Send a message or trigger an account action when classified as such. |
| destructive | Irreversible or high-impact browser change. | Close tab, destructive action. |

### 11.8 Browser tools

The model receives the following dynamic tools under ai_browser:

| Tool | Current behavior | Important constraint |
| --- | --- | --- |
| list_spaces | Lists persistent and allowed private Spaces. | Private Spaces are hidden unless policy allows them. |
| list_tabs | Lists visible/allowed tabs with Space and status metadata. | Private tabs are hidden unless allowed. |
| create_tab | Creates a tab in a selected/current Space and navigates it. | Max-tab and Space policy apply. |
| close_tab | Closes a tab. | Classified destructive and approval-gated in Guided mode. |
| activate_tab | Activates the tab and makes it visible. | Cross-Space activation must satisfy scope. |
| clone_tab | Creates a URL clone in another/current Space. | Login state is not transferred. |
| move_tab | Creates a URL clone in destination then closes source. | Login state is not transferred. |
| navigate | Direct URL or Google search. | HTTP(S) only after normalization. |
| back | Goes back in the target tab. | Target must be scoped. |
| forward | Goes forward in the target tab. | Target must be scoped. |
| reload | Reloads the target tab. | Target must be scoped. |
| get_page_context | Returns bounded structured page context. | No secret values or generic form values. |
| capture_screenshot | Captures the active page with sensitive rectangles masked. | Screenshot is ephemeral to Codex; a downscaled evidence thumbnail is stored currently. |
| scroll | Scrolls the page or a referenced element. | Requires a current context snapshot. |
| click | Clicks a referenced element or bounded screenshot coordinate. | Coordinate fallback requires an active screenshot context. |
| type | Types into a non-sensitive referenced field. | Password/payment/OTP-like fields are rejected. |
| select | Selects an option by value or label. | Requires a current context snapshot. |
| press_key | Dispatches key events to a referenced/focused element. | Current implementation is synthetic DOM dispatch, not native input injection. |
| submit_form | Requests form submission from a referenced form/control. | Classified as form-submit and approval-gated in Guided mode. |
| list_credentials | Lists credential IDs, origins, usernames, and Spaces. | Never returns password values. |
| fill_credential | Main process retrieves and sends credential to the target website preload. | Requires Vault policy, matching Space, and matching origin. |

All tools validate arguments, check policy, create a trace, and return compact results. Tool arguments are not persisted as raw records.

## 12. Page-agent implementation

### 12.1 Context snapshots

The website preload creates a short-lived page snapshot containing:

- Snapshot ID.
- URL and title.
- Bounded visible body text.
- Visible headings.
- Interactive element references such as ref_12.
- Role, tag, label, placeholder, disabled state, and coarse value state.
- Scroll position, document size, and viewport size.
- Sensitive rectangles for screenshot masking.

The body text and interactive element list are bounded to prevent unbounded page extraction.

### 12.2 Stable references

References are temporary. The mapping is invalidated after navigation and after agent actions that can mutate the page, including click, type, select, press, scroll, submit, and credential fill. The agent is expected to request fresh context after a mutation.

Arbitrary site DOM mutations that happen independently of agent actions do not automatically invalidate the snapshot, so stale-reference handling remains a known limitation.

### 12.3 Interaction rules

- Clicks can use semantic references.
- Coordinate clicks require an active screenshot context.
- Coordinates are bounded to the current viewport.
- Generic typing into sensitive-looking inputs is rejected.
- Credential filling is separate and direct from main process to website preload.
- Select and submit operations require a valid current snapshot.
- Page action results contain metadata, not raw secret field values.

## 13. Browser API contracts

The shared browser contract is in src/shared/contracts.ts.

### 13.1 BrowserAPI

~~~ts
interface BrowserAPI {
  getSnapshot(): Promise<AppSnapshot>;
  dispatch(command: BrowserCommand): Promise<CommandResult>;
  subscribe(listener: (event: BrowserEvent) => void): () => void;
  setBrowserViewport(bounds: BrowserViewportBounds): void;
}
~~~

### 13.2 Browser commands

~~~text
space.create
space.rename
space.updateAppearance
space.delete
space.select
space.createPrivate

tab.create
tab.activate
tab.close
tab.cloneToSpace
tab.moveToSpace
tab.hibernate
tab.restore

navigation.back
navigation.forward
navigation.reload
navigation.search

bookmark.create
bookmark.remove

site.inspect
site.clearData
site.forget

credential.save
credential.reject
credential.fill
credential.remove
~~~

### 13.3 Browser events

~~~text
snapshot
credential-save-request
toast
~~~

The credential-save-request event contains the request ID, tab/Space, origin/hostname, and username, but not the password.

## 14. Agent API contracts

The shared agent contract is in src/shared/agent-contracts.ts.

### 14.1 AgentAPI

~~~ts
interface AgentAPI {
  getSnapshot(): Promise<AgentSnapshot>;
  dispatch(command: AgentCommand): Promise<AgentCommandResult>;
  getEvidence(id: string): Promise<AgentEvidence | null>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
}
~~~

### 14.2 Agent commands

~~~text
agent.thread.create
agent.thread.select
agent.thread.rename
agent.thread.delete

agent.message.send

agent.run.pause
agent.run.resume
agent.run.stop

agent.policy.update
agent.model.update
agent.approval.respond
~~~

### 14.3 Agent events

~~~text
agent.snapshot
agent.message.delta
agent.action
agent.approval-request
agent.connection
agent.evidence
agent.error
~~~

### 14.4 Data intentionally excluded from renderer snapshots

The renderer does not receive:

- Passwords.
- Cookies.
- Raw local storage or IndexedDB values.
- Raw Codex credentials.
- Codex remote thread IDs.
- Raw tool arguments.
- Raw DOM snapshots.
- Full-resolution screenshots.
- Hidden form values.

## 15. Main runtime flows

### 15.1 Application startup

~~~text
Electron ready
  ├─ set dark native theme
  ├─ load app-state.json
  ├─ load vault.enc if safeStorage is available
  ├─ load agent-state.json and evidence index
  ├─ create BrowserRuntime
  ├─ create AgentRuntime
  ├─ register typed IPC handlers
  ├─ create WebContentsViews for persisted tabs
  ├─ attach the active tab
  └─ load React chrome
~~~

Codex is not spawned at startup. It starts when an agent thread needs a connection.

### 15.2 Browser navigation

~~~text
User or agent submits text
  ├─ HTTP(S) input ─► direct navigation
  └─ other input ───► Google search URL
                         │
                         ▼
                 BrowserRuntime.loadURL
                         │
                         ├─ update tab loading/title/favicon
                         └─ upsert Space-owned SiteRecord
~~~

### 15.3 Credential save

~~~text
Website submit/click/Enter
  └─ browser-preload detects candidate
       └─ main validates sender tab and origin
            ├─ private / unavailable / never-save ─► discard
            └─ eligible ─► pending in-memory request
                              └─ React prompt
                                   ├─ Save ─► safeStorage vault
                                   ├─ Not now ─► discard
                                   └─ Never ─► mark site denylist
~~~

The candidate is time-limited and is not placed into the React event or AgentSnapshot.

### 15.4 Credential fill

~~~text
User or agent selects credential
  └─ main validates credential ID, Space, and target origin
       └─ main retrieves password from vault
            └─ website preload fills the matching form
                 └─ only success/failure metadata returns
~~~

### 15.5 Agent turn

~~~text
User sends message
  ├─ local /scope, /allow, /deny command? ─► update policy locally
  └─ ordinary message
       └─ ensure Codex connection
            └─ start/resume remote thread
                 └─ turn/start
                      ├─ assistant deltas ─► Agent dock transcript
                      └─ ai_browser tool call
                           ├─ policy check
                           ├─ approval check
                           ├─ BrowserRuntime action
                           ├─ action trace/evidence
                           └─ compact tool result to Codex
~~~

### 15.6 Screenshot flow

~~~text
capture_screenshot
  ├─ activate target tab
  ├─ request current page context and sensitive rectangles
  ├─ enable temporary redaction overlay
  ├─ capture page
  ├─ disable overlay
  ├─ downscale for model input if needed
  └─ store a downscaled evidence thumbnail
~~~

### 15.7 Tab move flow

~~~text
move tab A from Personal to Work
  ├─ read A.url
  ├─ create new tab B in Work
  ├─ load A.url using Work session
  └─ close A
~~~

Cookies and login state never cross this boundary.

## 16. Test and verification status

### 16.1 Existing automated tests

tests/state-store.test.mjs verifies:

- Default persistent Spaces and tabs can be seeded.
- Private state is excluded from persisted browser state.
- The last persistent Space cannot be deleted.

tests/agent-foundation.test.mjs verifies:

- Agent metadata persists.
- Password/cookie/raw-DOM-shaped values are absent from persisted agent state.
- Private agent threads are not written to disk.
- Active runs restore as paused.
- Policy mode behavior, private access, origin matching, wildcard matching, approval classification, and maximum tab count.

tests/codex-client.test.mjs verifies:

- A temporary fake Codex executable can be spawned.
- Concurrent response correlation works.
- Malformed output rejects pending calls.

### 16.2 Checks last verified during this audit cycle

The implementation had already passed the following checks after the AI foundation changes:

~~~text
npm run typecheck  ✅
npm test           ✅ 7 tests passed
npm run build      ✅
git diff --check   ✅
~~~

A direct local Codex smoke test also reached:

~~~text
STATUS starting
STATUS ready
THREAD <ephemeral thread id>
TURN_COMPLETED
STATUS stopped
~~~

An Electron smoke test loaded the custom renderer and active browser view without the earlier black renderer problem. Linux Wayland color-management warnings may still appear in the terminal; those warnings are platform graphics diagnostics, not evidence that the renderer is blank.

### 16.3 What is not covered by tests

The following are not currently covered by automated or fixture tests:

- Launching a real BrowserWindow in a test harness.
- Creating and switching real WebContentsView tabs.
- Personal/Work cookie isolation against local HTTP fixtures.
- Restarting and verifying login state.
- Dynamic SPA login detection end to end.
- Credential save prompt acceptance/rejection.
- Credential fill into a real form.
- Screenshot redaction against real sensitive fields.
- Semantic references after real DOM mutation.
- Form submission approval in Guided mode.
- Full-mode fixture workflow completion.
- Observe-mode mutation denial through a real page.
- Stop behavior during a real browser action.
- Codex crash/reconnect/resume.
- Browser viewport correctness under resize/maximize and Agent dock transitions.
- Accessibility keyboard navigation and screen-reader behavior.
- Packaging, code signing, installation, and update behavior.

## 17. Missing features, known issues, and improvements

This section is intentionally explicit. These are the main gaps identified from the current source and the original product requirements.

### 17.1 Highest-priority hardening

#### A. Sanitize browser and page error logging

**Current behavior:** browser load failures and console events can log raw page-derived messages.  
**Risk:** page text, URLs, form-related errors, or user data could appear in local logs.  
**Area:** src/main/browser-runtime.ts.  
**Improvement:** remove raw message logging or replace it with event type, error code, origin, and a bounded redacted diagnostic ID. Never log console arguments or form values.

#### B. Serialize browser mutations

**Current behavior:** dynamic browser tools can be invoked while another browser mutation, navigation, tab close, or view replacement is still running.  
**Risk:** races can produce stale view references, wrong active tabs, conflicting navigation, or actions applied to a tab that has just moved or hibernated.  
**Area:** src/main/browser-runtime.ts and src/ai/browser-agent-tools.ts.  
**Improvement:** add a main-process action queue or per-tab mutex, cancellation tokens, deadlines, and explicit safe boundaries for activation, navigation, and DOM actions.

#### C. Add real browser fixture tests

**Current behavior:** agent and browser behavior is covered primarily by unit tests and fake Codex protocol tests.  
**Risk:** the most important product claims—session isolation, credential handling, page references, redaction, Guided mode, and Stop—are not tested against real pages.  
**Improvement:** create a local fixture server and Electron integration harness before adding more agent capability.

#### D. Make stop and shutdown cancel all pending work

**Current behavior:** Stop interrupts the Codex turn and clears approvals, but pending BrowserRuntime page requests and credential-fill requests can remain until their timers expire.  
**Risk:** late responses can arrive after a tab was destroyed or a run was stopped.  
**Improvement:** add cancellation propagation from AgentRuntime to BrowserAgentTools and BrowserRuntime; reject pending page/fill requests on tab destruction, Space deletion, window shutdown, and Stop.

### 17.2 Important correctness and privacy gaps

#### E. Harden credential detection against real sites

**Current behavior:** the preload listens in the capture phase for submit, likely login clicks, and Enter key events and extracts a candidate username plus password.  
**Gap:** custom controls, shadow DOM, React form behavior, WebAuthn, password managers, multi-step login, and non-button submission patterns are not covered by fixtures.  
**Improvement:** test and refine form association, avoid duplicate prompts, handle dynamic forms safely, and add explicit diagnostics that never include secrets.

#### F. Improve sensitive-field detection and redaction

**Current behavior:** selectors and attribute-name heuristics cover common password, card, CVV, CVC, OTP, and security-code fields.  
**Gap:** custom widgets, shadow DOM, canvas-based inputs, accessibility-only labels, and unusual names may be missed.  
**Improvement:** combine semantic labels, input types, autocomplete tokens, form ownership, and bounded site-side metadata. Add fixture screenshots with expected redaction regions.

#### G. Add site-data confirmation

**Current behavior:** Site drawer clear/forget buttons dispatch immediately.  
**Gap:** the product requirement calls for a confirmation that explains the user may be logged out and distinguishes metadata removal, website-data clearing, credential removal, and all actions.  
**Improvement:** add a modal with explicit checkboxes/actions and a final confirmation step for destructive combinations.

#### H. Correct site storage reporting

**Current behavior:** storagePresent is approximated from cookie presence.  
**Risk:** a site can have local storage/IndexedDB/cache without cookies, or cookies can exist without the application knowing the full storage picture.  
**Improvement:** expose separate bounded indicators using supported Electron session APIs, with unknown when exact inspection is unavailable rather than conflating storage with cookies.

#### I. Review bookmark/site consistency

**Current behavior:** bookmark creation updates site state separately, but the generic bookmark removal path appears to look up a site using the bookmark ID rather than matching by Space and origin/URL.  
**Risk:** removing a bookmark may leave the site’s bookmarked flag stale.  
**Improvement:** match the related site by normalized Space plus origin or recompute bookmark state after mutations, then add a regression test.

#### J. Mark stale tab references explicitly

**Current behavior:** persistent Agent threads retain tab/Space references, but deleted or moved tabs are not represented with a dedicated unavailable marker in the transcript or thread UI.  
**Risk:** a resumed thread may attempt to act on a stale ID and only receive a generic failure.  
**Improvement:** record stale-reference status and show a repair action requiring the user to choose a new target; never silently reassign.

### 17.3 Codex protocol and reliability gaps

#### K. Add bounded reconnect and crash recovery

**Current behavior:** a Codex process crash produces a crashed state; a later command may start a new client.  
**Gap:** there is no bounded backoff/reconnect state machine, automatic resume, or clear recovery workflow for an active persistent thread.  
**Improvement:** add one reconnect attempt policy, exponential backoff with a ceiling, turn recovery rules, and clear user-visible diagnostics.

#### L. Complete protocol validation

**Current behavior:** line size, JSON parsing, request correlation, and basic response validation are implemented.  
**Gap:** not every notification and server request is validated against a complete schema; item/started and item/completed are not fully represented in the UI flow.  
**Improvement:** use explicit discriminated validators for all accepted methods, reject unknown shapes safely, and preserve useful lifecycle events without storing raw content.

#### M. Improve connection/auth/model UX

**Current behavior:** connection states and model options exist in the snapshot.  
**Gap:** there is no dedicated setup page for missing Codex, unauthenticated Codex, or Luna unavailable; the user may not know what local action is required.  
**Improvement:** add actionable states: check executable, authenticate Codex, refresh model list, and explain why fallback is intentionally disabled.

### 17.4 State and storage gaps

#### N. Implement actual schema migration

**Current behavior:** browser, agent, vault, and evidence documents carry version fields.  
**Gap:** version 1 is effectively the only supported schema; malformed or newer documents can reset or fail without a migration/recovery UI.  
**Improvement:** create migration functions, backup before upgrade, validate every required field, preserve unknown fields where safe, and surface recovery status.

#### O. Improve crash safety of writes

**Current behavior:** debounced temp-file-plus-rename writes are used.  
**Gap:** no fsync, journal, backup, or interrupted-write recovery test exists.  
**Improvement:** add backup rotation or a small journal, fsync where platform support permits, and test power-loss-style interruptions.

#### P. Add agent transcript retention controls

**Current behavior:** full message/action arrays are stored in one JSON document.  
**Gap:** there is no message count/byte limit, pagination, retention policy, export, or selective deletion.  
**Improvement:** cap transcript size, archive compact summaries, and provide thread export/delete controls.

#### Q. Harden private session cleanup

**Current behavior:** private state is excluded from JSON and private partitions are non-persistent.  
**Gap:** the session manager does not expose explicit partition destruction or a verified cleanup step.  
**Improvement:** add lifecycle-owned private session teardown and test that no private session directory or state survives application close.

#### R. Add evidence management

**Current behavior:** screenshots are downscaled and retained up to 20 per thread.  
**Gap:** the user cannot pin, delete, or prevent a particular screenshot from persistence; there is no total quota.  
**Improvement:** add pin/delete commands, per-thread and global quotas, cleanup on thread deletion, and a clear evidence-retention indicator.

### 17.5 Interface gaps

#### S. Complete Space appearance controls

The backend supports space.updateAppearance, but the Space rail currently exposes rename/delete rather than color/icon editing.

#### T. Add tab drag interactions

The product plan called for drag reordering and drag-to-Space clone/move. The current tab deck supports click menus only.

#### U. Complete thread management

The contract supports thread rename/delete, but the Agent dock does not currently expose full thread management controls. The thread strip also only displays the first few threads rather than a complete searchable list.

#### V. Add reasoning-effort control

The model contract stores low/medium/high reasoning effort and agent.model.update accepts it, but the Agent dock currently preserves the existing effort rather than offering a dedicated picker.

#### W. Add tab and transcript search

The product plan calls for command-dock tab filtering/search. The current command field navigates pages and does not provide a separate tab search mode.

#### X. Make page-sharing status more explicit

Opening Agent mode serves as consent and the dock shows page context as enabled. A durable per-thread page-sharing control and clearer explanation of what is shared are still needed.

#### Y. Improve startup/loading/error surfaces

There is no comprehensive React error boundary, startup skeleton, or renderer-side recovery panel. Vite preview without Electron’s preload is also not a faithful browser runtime and should communicate that limitation more clearly.

#### Z. Accessibility and keyboard navigation

The UI has labels and basic control semantics, but there has been no formal keyboard traversal, focus management, screen-reader, contrast, reduced-motion, or automated accessibility audit.

### 17.6 Product features intentionally not implemented

These are not bugs in this milestone, but they are future work if the product direction remains unchanged:

- Full browser history and recently closed tabs.
- Downloads tray and download permissions.
- Extension installation/runtime.
- Site permission dashboard.
- Clipboard read/write policies.
- File upload/download agent actions.
- OS dialog interaction.
- WebAuthn/passkey workflows.
- Native password-manager import.
- Encrypted vault export/import.
- Sync across devices.
- AI scheduled/background tasks.
- AI long-term memory beyond thread transcripts.
- Multi-agent collaboration.
- Billing/model usage reporting.
- Installer signing and auto-updates.

## 18. Recommended implementation roadmap

### Phase 1 — Safety and lifecycle hardening

1. Remove or sanitize page-derived logging.
2. Add cancellation and serialized browser mutations.
3. Reject all pending page/fill requests on tab/Space/runtime shutdown.
4. Add site-data confirmation UI.
5. Fix bookmark/site consistency and add regression tests.
6. Tighten policy wildcard validation.

### Phase 2 — Local browser fixture suite

Build a fixture server with:

- Basic login form.
- Dynamic SPA login form.
- Multi-page navigation.
- Editable grid.
- Mail composition and send button.
- Prompt-injection text.
- Sensitive/password/card/OTP fields.

Then add a real Electron harness that verifies session isolation, context references, redaction, Guided approval, Full completion, Observe denial, tab lifecycle, and Stop.

### Phase 3 — Codex reliability

1. Complete protocol validators.
2. Add bounded reconnect and persistent-thread resume.
3. Add model/auth setup states.
4. Add turn/action deadlines and recovery diagnostics.
5. Preserve lifecycle events in compact traces.

### Phase 4 — Product-surface completion

1. Add Space color/icon editor.
2. Add thread rename/delete/search.
3. Add reasoning effort selector.
4. Add tab drag reorder and drag-to-Space behavior.
5. Add evidence pin/delete/quota controls.
6. Add tab search and clearer page-sharing controls.
7. Add accessible focus management.

### Phase 5 — Storage and distribution

1. Add state migrations and backup recovery.
2. Add vault lock/export/import design.
3. Add private-session teardown verification.
4. Add packaging, code signing, installation, update, and crash-reporting strategy.
5. Add performance measurements for many tabs, many threads, large transcripts, and repeated screenshots.

## 19. Manual verification checklist

Use a local fixture site before using a real authenticated site. Real-site testing can send messages, change accounts, submit forms, or make purchases, so every external action must be visibly reviewed first.

### Browser foundation

- [ ] Launch the app with npm start.
- [ ] Confirm the custom frame is visible and there is no black renderer region.
- [ ] Confirm the unified top dock and Space rail are visible.
- [ ] Confirm Google content begins below the chrome.
- [ ] Create two tabs in Personal.
- [ ] Create a Work tab and verify it appears in All Spaces.
- [ ] Activate the Work tab from All Spaces.
- [ ] Clone a Personal URL into Work and verify login state is not copied.
- [ ] Move a tab and verify the original closes.
- [ ] Hibernate and restore a tab; confirm URL and Space identity remain.
- [ ] Resize, maximize, restore, and close the window.

### Session isolation

- [ ] Log into the fixture site in Personal.
- [ ] Open the same fixture origin in Work.
- [ ] Verify Work is not logged in.
- [ ] Restart the app.
- [ ] Verify Personal remains logged in.
- [ ] Create a Private Space.
- [ ] Verify its session does not appear in a new app process.

### Credential behavior

- [ ] Submit the fixture login form.
- [ ] Confirm the save prompt appears without showing the password in React devtools/state.
- [ ] Choose Save and verify a summary appears in Vault.
- [ ] Choose Not now and verify no credential is created.
- [ ] Choose Never for this site and verify future prompts are suppressed.
- [ ] Fill the saved credential explicitly.
- [ ] Verify the model/Agent transcript contains only credential ID, site, username, and result metadata.
- [ ] Remove credentials without clearing the website session and verify the session remains.

### Agent behavior

- [ ] Open Agent and confirm connection/model state.
- [ ] Create a persistent thread.
- [ ] Use Observe mode to read context and verify mutations are denied.
- [ ] Use Guided mode to navigate and click a safe control.
- [ ] Confirm Guided mode requests approval before submit and credential fill.
- [ ] Use Full mode for a harmless local fixture workflow.
- [ ] Confirm actions on an inactive tab activate that tab visibly.
- [ ] Test /scope, /allow, and /deny commands.
- [ ] Confirm private access is denied unless explicitly enabled.
- [ ] Capture a screenshot and verify sensitive fields are masked.
- [ ] Stop a running turn and confirm no late browser mutation completes.
- [ ] Restart and verify persistent thread transcript/action summaries restore.
- [ ] Delete a thread and verify its evidence is removed.

## 20. Troubleshooting

### The window is blank or black

Check these first:

1. Run npm run build before npm start.
2. In development, verify Vite is listening on 127.0.0.1:5173.
3. Confirm Electron is not inheriting ELECTRON_RUN_AS_NODE.
4. Inspect the terminal for renderer load errors rather than Wayland color-management warnings alone.
5. Confirm the active WebContentsView is attached after the browser viewport is measured.

The previous black-window issue was caused by the browser surface/layout/runtime path rather than the Linux color-management warnings. The current implementation has been smoke-tested with the custom chrome and active browser view.

### Wayland color-management messages

Messages such as:

~~~text
Unable to set image transfer function
Failed to populate image description for color space
~~~

are Chromium/Wayland diagnostics. They do not necessarily indicate that the React renderer or website view failed. Verify the visible window and check for actual load errors separately.

### codex is missing

The browser foundation should continue working. The Agent dock will remain unavailable or show a missing-connection state. Install/authenticate Codex separately; the application does not use an API-key fallback in this milestone.

### Codex is installed but the Agent is unauthenticated

The app-server reuses the local Codex authentication. Confirm the local Codex CLI is authenticated outside the browser and that codex app-server --stdio can start successfully. The current application does not provide a complete login/setup wizard.

### Luna is unavailable

The model picker is populated by model/list. If gpt-5.6-luna is not returned or cannot be started, the browser should report that state. It intentionally does not silently substitute another model.

### Credentials cannot be saved

Check:

- Electron safeStorage.isEncryptionAvailable().
- The platform secure-store backend; Linux basic_text is treated as unavailable.
- Whether the page generated a detectable submit/click/Enter event.
- Whether the current Space is private.
- Whether the site has been marked “never save credentials.”
- Whether the pending prompt expired.

### Vite preview does not behave like the browser

The Vite page can display the React chrome, but it does not have Electron’s preload or WebContentsView. Browser navigation, window controls, session state, and website rendering require Electron.

## 21. Decisions and rationale

### Custom frameless window

The product requires a distinctive browser rather than a default OS titlebar. A frameless Electron window leaves the entire top surface to the unified command dock and custom controls.

### WebContentsView instead of iframe pages

Websites retain normal browser behavior, cookies, navigation, and Chromium isolation. Rendering sites inside React would make session isolation and browser control less reliable and would create unnecessary security boundaries.

### Session isolation by Space

A visual label alone would not protect account state. Electron partitions make Personal and Work genuinely separate at the Chromium storage layer.

### Local Codex app-server

Using the installed Codex app-server avoids putting an API key into this application and creates an adapter boundary for future Codex protocol changes. It also means AI availability depends on the user’s local Codex installation and authentication.

### No shell or desktop automation

The first agent scope is browser-only. This limits the impact of prompt injection and makes the initial policy model understandable. Shell, filesystem, downloads, OS dialogs, and arbitrary apps are intentionally denied.

### Explicit credential fill

Passwords are more sensitive than ordinary page text. Keeping them in main process memory and sending them directly to the website preload prevents the model and React from becoming password transport layers.

### Global threads, Space-scoped browser work

An AI task may need to reference Personal and Work tabs in one conversation, while each tab still retains its own session identity. Threads are global; browser data remains Space-local.

### Full, Guided, Observe

The three modes provide a simple user mental model:

- Observe lets the user inspect what the agent sees.
- Guided gives approval at high-impact boundaries.
- Full allows an explicitly enabled workflow to proceed without interrupting every safe click.

## 22. Definition of done for the next foundation milestone

The next milestone should not be considered complete until all of the following are true:

- [ ] No raw page-derived console/error content is written to logs.
- [ ] Browser mutations are serialized and cancellable.
- [ ] Stop cancels Codex, approvals, browser requests, and pending fills.
- [ ] Site clearing has a confirmation surface with clear consequences.
- [ ] Browser fixture tests verify Personal/Work cookie isolation.
- [ ] Credential save and fill pass fixture tests without secret leakage.
- [ ] Screenshot redaction has fixture coverage.
- [ ] Guided, Full, and Observe behavior pass real Electron tests.
- [ ] Codex crash/reconnect/resume behavior is deterministic.
- [ ] State migration and interrupted-write recovery are tested.
- [ ] Stale tab references are visible and never silently reassigned.
- [ ] Space appearance, thread management, evidence management, and tab search are either implemented or explicitly removed from the product promise.
- [ ] Accessibility and viewport behavior are tested at small and large window sizes.

## 23. File-by-file reference

### Application and configuration

- package.json: package metadata, dependencies, and npm scripts.
- package-lock.json: npm dependency lockfile.
- tsconfig.json: renderer TypeScript configuration.
- tsconfig.electron.json: main/preload/shared TypeScript configuration.
- vite.config.mts: Vite React build and development-server configuration.
- src/renderer/index.html: renderer HTML shell and CSP.

### Browser implementation

- src/main.ts: Electron bootstrap and shutdown.
- src/main/browser-runtime.ts: browser runtime.
- src/main/browser-preload.ts: website-side page/credential bridge.
- src/main/space-session-manager.ts: partition/session ownership.
- src/main/state-store.ts: browser metadata persistence.
- src/main/secret-vault.ts: encrypted credential vault.
- src/main/ipc.ts: browser/window IPC.
- src/preload.ts: React chrome preload.

### AI implementation

- src/ai/codex-protocol.ts: wire protocol types.
- src/ai/codex-app-server-client.ts: Codex child process and JSON-RPC adapter.
- src/ai/agent-policy.ts: policy decisions.
- src/ai/browser-agent-tools.ts: browser tools and action traces.
- src/ai/agent-runtime.ts: threads, turns, events, approvals, and commands.
- src/ai/agent-state-store.ts: persistent agent state.
- src/ai/agent-evidence-store.ts: evidence thumbnails.
- src/main/agent-ipc.ts: AgentAPI bridge.

### Renderer implementation

- src/renderer/main.tsx: all current React chrome and interaction components.
- src/renderer/styles.css: visual system, layout, responsive behavior, and dark surfaces.

### Contracts

- src/shared/contracts.ts: browser state and commands.
- src/shared/agent-contracts.ts: agent state, commands, events, and page contracts.
- src/types/window.d.ts: global window.browserAPI and window.agentAPI declarations.

### Tests

- tests/state-store.test.mjs: browser persistence tests.
- tests/agent-foundation.test.mjs: agent state and policy tests.
- tests/codex-client.test.mjs: Codex adapter integration tests.

## 24. Final project assessment

The repository has moved beyond the original Google-only shell. It now contains a coherent browser foundation and the first working AI-agent architecture: isolated Spaces, a global tab model, a unified custom chrome, main-process authority, encrypted credential storage, page context tools, screenshot support, policy modes, local Codex integration, and persistent agent threads.

The most important remaining work is not adding more agent tools. It is proving and hardening the existing trust boundaries: real fixture-based browser tests, cancellation and serialization, sanitized logging, robust credential/redaction behavior, site-clear confirmation, Codex recovery, and state migration. Those areas should be completed before expanding into more powerful browser actions or external side effects.
