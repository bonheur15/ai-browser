import {
  type FormEvent,
  type ReactNode,
  StrictMode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import type {
  AgentActionClass,
  AgentCommand,
  AgentEvent,
  AgentMode,
  AgentPolicy,
  AgentSnapshot,
} from "../shared/agent-contracts";
import type {
  AppSnapshot,
  BrowserCommand,
  BrowserEvent,
  BrowserRuntimeStatus,
  CredentialSaveRequest,
  Space,
  SpaceScope,
  Tab,
} from "../shared/contracts";
import { hostFor, originFor } from "./renderer-utils";
import "./styles.css";

const emptySnapshot: AppSnapshot = {
  spaces: [],
  tabs: [],
  bookmarks: [],
  sites: [],
  credentials: [],
  scope: "all",
  activeSpaceId: "",
  activeTabId: null,
  drawer: null,
  selectedSiteId: null,
  vaultAvailable: false,
};

const emptyAgentSnapshot: AgentSnapshot = {
  connection: { status: "stopped" },
  threads: [],
  activeThreadId: null,
  messages: [],
  actions: [],
  approvalRequests: [],
  modelOptions: [],
  globalDefaults: {
    mode: "full",
    allowedSpaceIds: null,
    allowedTabIds: null,
    allowedOrigins: null,
    allowedActions: [
      "read",
      "navigate",
      "tab-management",
      "page-interaction",
      "credential-fill",
      "form-submit",
      "external-side-effect",
      "destructive",
    ],
    allowVault: true,
    allowPrivate: false,
    maxTabs: 24,
  },
};

const agentActionOptions: Array<[AgentActionClass, string]> = [
  ["read", "Read"],
  ["navigate", "Navigate"],
  ["tab-management", "Tabs"],
  ["page-interaction", "Interact"],
  ["credential-fill", "Vault"],
  ["form-submit", "Submit"],
  ["external-side-effect", "External effects"],
  ["destructive", "Destructive"],
];

const iconFor = (icon: string): string =>
  ({
    home: "⌂",
    briefcase: "▣",
    eye: "◉",
    "eye-off": "◌",
    sparkles: "✦",
  })[icon] ?? "✦";

const emptyRuntimeStatus: BrowserRuntimeStatus = {
  activeTabId: null,
  memoryUsageMb: null,
  security: "special",
  securityMessage: "This is a browser-generated or special page",
  loading: false,
  sampledAt: "",
};

const agentStatusLabel = (status: AgentSnapshot["connection"]["status"]): string =>
  ({
    ready: "Ready",
    starting: "Starting",
    stopped: "Stopped",
    missing: "Missing",
    unauthenticated: "Unauthenticated",
    crashed: "Crashed",
  })[status];

function BottomStatusToolbar({
  snapshot,
  runtimeStatus,
  agentSnapshot,
  activeTab,
  activeSpace,
}: {
  snapshot: AppSnapshot;
  runtimeStatus: BrowserRuntimeStatus;
  agentSnapshot: AgentSnapshot;
  activeTab: Tab | undefined;
  activeSpace: Space | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const revealTimer = useRef<number | null>(null);
  const collapseTimer = useRef<number | null>(null);

  const clearTimers = (): void => {
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
    revealTimer.current = null;
    collapseTimer.current = null;
  };

  const reveal = (): void => {
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
    revealTimer.current = window.setTimeout(() => setOpen(true), 120);
  };

  const collapse = (): void => {
    if (focused) return;
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    collapseTimer.current = window.setTimeout(() => setOpen(false), 420);
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent): void => {
      if (event.clientY >= window.innerHeight - 16) reveal();
      else if (open && !focused) collapse();
    };
    const onFocusIn = (event: FocusEvent): void => {
      if ((event.target as HTMLElement | null)?.closest(".bottom-status-toolbar")) {
        clearTimers();
        setFocused(true);
        setOpen(true);
      }
    };
    const onFocusOut = (): void => {
      window.setTimeout(() => {
        const inside = document.activeElement?.closest(".bottom-status-toolbar") !== null;
        setFocused(inside);
        if (!inside) collapse();
      }, 0);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && open && !focused) {
        clearTimers();
        setOpen(false);
      }
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimers();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [focused, open]);

  const tabCount = snapshot.tabs.filter((tab) => tab.spaceId === activeSpace?.id).length;
  const securityLabel =
    runtimeStatus.security === "secure"
      ? "Secure"
      : runtimeStatus.security === "not-secure"
        ? "Not secure"
        : "Special page";
  const memoryLabel =
    runtimeStatus.memoryUsageMb === null
      ? "RAM unavailable"
      : `${runtimeStatus.memoryUsageMb.toFixed(1)} MB RAM`;
  const connectionStatus = agentSnapshot.connection.status;

  return (
    <section
      className={`bottom-status-toolbar${open ? " is-open" : ""}`}
      aria-label="Browser status"
      tabIndex={0}
      onPointerEnter={() => {
        clearTimers();
        setOpen(true);
      }}
      onPointerLeave={collapse}
      onFocusCapture={() => {
        clearTimers();
        setFocused(true);
        setOpen(true);
      }}
      onBlurCapture={() =>
        window.setTimeout(() => {
          if (!document.activeElement?.closest(".bottom-status-toolbar")) {
            setFocused(false);
            collapse();
          }
        }, 0)
      }
      onClick={(event) => event.stopPropagation()}
    >
      <div className="bottom-status-inner">
        <div className="bottom-status-context" title={activeTab?.url ?? "No active page"}>
          <span className="bottom-status-glyph">◈</span>
          <span className="bottom-status-copy">
            <strong>{activeSpace?.name ?? "All Spaces"}</strong>
            <small>
              {activeTab?.title ?? "No active page"} · {tabCount} tabs
            </small>
          </span>
        </div>
        <span className="bottom-status-divider" />
        <div
          className={`bottom-status-item status-security-${runtimeStatus.security}`}
          title={runtimeStatus.securityMessage}
          aria-label={`${securityLabel}: ${runtimeStatus.securityMessage}`}
        >
          <span className="bottom-status-dot" />
          <span>
            <strong>{securityLabel}</strong>
            <small>Page security</small>
          </span>
        </div>
        <div
          className="bottom-status-item"
          title={runtimeStatus.loading ? "The active page is loading" : "The active page is loaded"}
          aria-label={runtimeStatus.loading ? "Page is loading" : "Page is loaded"}
        >
          <span className={`bottom-status-load${runtimeStatus.loading ? " is-loading" : ""}`}>
            {runtimeStatus.loading ? "◌" : "✓"}
          </span>
          <span>
            <strong>{runtimeStatus.loading ? "Loading" : "Ready"}</strong>
            <small>Browser state</small>
          </span>
        </div>
        <div
          className="bottom-status-item"
          title="Aggregate Electron browser process memory usage"
          aria-label={memoryLabel}
        >
          <span className="bottom-status-memory">▥</span>
          <span>
            <strong>{memoryLabel}</strong>
            <small>Browser usage</small>
          </span>
        </div>
        <span className="bottom-status-divider" />
        <div
          className={`bottom-status-item status-agent-${connectionStatus}`}
          title={`AI connection: ${agentStatusLabel(connectionStatus)}`}
          aria-label={`AI connection ${agentStatusLabel(connectionStatus)}`}
        >
          <span className="bottom-status-ai">✧</span>
          <span>
            <strong>AI {agentStatusLabel(connectionStatus)}</strong>
            <small>Connection</small>
          </span>
        </div>
      </div>
    </section>
  );
}

function WindowButton({
  label,
  onClick,
  children,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      className={`window-button${danger ? " window-button-danger" : ""}`}
      type="button"
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function IconButton({
  label,
  onClick,
  children,
  active = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button${active ? " is-active" : ""}`}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function SpaceRail({
  snapshot,
  onScope,
  onCreate,
  onPrivate,
  onSpaceMenu,
  menuSpaceId,
  onRename,
  onDelete,
}: {
  snapshot: AppSnapshot;
  onScope: (scope: SpaceScope) => void;
  onCreate: () => void;
  onPrivate: () => void;
  onSpaceMenu: (spaceId: string) => void;
  menuSpaceId: string | null;
  onRename: (space: Space) => void;
  onDelete: (space: Space) => void;
}) {
  const tabsIn = (spaceId: string): number =>
    snapshot.tabs.filter((tab) => tab.spaceId === spaceId).length;

  return (
    <aside className="space-rail" aria-label="Spaces">
      <button
        className={`scope-orb${snapshot.scope === "all" ? " is-active" : ""}`}
        type="button"
        onClick={() => onScope("all")}
        title="All Spaces"
      >
        <span className="orb-glyph">◈</span>
        <span className="orb-label">All</span>
      </button>

      <div className="rail-divider" />

      <div className="space-list">
        {snapshot.spaces.map((space) => (
          <div className="space-item" key={space.id}>
            <button
              className={`space-pill${snapshot.scope === space.id ? " is-active" : ""}`}
              type="button"
              onClick={() => onScope(space.id)}
              title={`${space.name} · ${tabsIn(space.id)} tabs`}
            >
              <span
                className="space-icon"
                style={{ "--space-color": space.color } as React.CSSProperties}
              >
                {iconFor(space.icon)}
              </span>
              <span className="space-name">{space.name}</span>
              <span className="space-count">{tabsIn(space.id)}</span>
            </button>
            <button
              className="space-more"
              type="button"
              aria-label={`Actions for ${space.name}`}
              onClick={() => onSpaceMenu(space.id)}
            >
              •••
            </button>
            {menuSpaceId === space.id && (
              <div className="space-menu">
                <button type="button" onClick={() => onRename(space)}>
                  Rename Space
                </button>
                <button type="button" onClick={() => onDelete(space)}>
                  Delete Space
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="rail-actions">
        <IconButton label="Create a new Space" onClick={onCreate}>
          <span className="glyph-plus">+</span>
        </IconButton>
        <IconButton label="Open a temporary Private Space" onClick={onPrivate}>
          <span className="glyph-private">◌</span>
        </IconButton>
      </div>
      <div className="rail-footnote">
        LOCAL
        <br />
        FIRST
      </div>
    </aside>
  );
}

function CommandDock({
  snapshot,
  activeTab,
  activeSpace,
  maximized,
  onDispatch,
  onOpenVault,
  onOpenSite,
  agentOpen,
  onToggleAgent,
  onToggleMaximize,
}: {
  snapshot: AppSnapshot;
  activeTab: Tab | undefined;
  activeSpace: Space | undefined;
  maximized: boolean;
  onDispatch: (command: BrowserCommand) => void;
  onOpenVault: () => void;
  onOpenSite: () => void;
  agentOpen: boolean;
  onToggleAgent: () => void;
  onToggleMaximize: () => void;
}) {
  const [input, setInput] = useState(activeTab?.url ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInput(activeTab?.url ?? "");
    if (activeTab?.url === "about:blank") {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [activeTab?.id, activeTab?.url]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (event.key === "Escape" && document.activeElement === inputRef.current)
        inputRef.current?.blur();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!activeTab) return;
    onDispatch({ type: "navigation.search", tabId: activeTab.id, input });
  };

  const dispatchTabCommand = (
    type: "navigation.back" | "navigation.forward" | "navigation.reload",
  ): void => {
    if (activeTab) onDispatch({ type, tabId: activeTab.id });
  };

  return (
    <section className="command-dock" aria-label="Command dock">
      <div className="dock-brand" aria-label="AI Browser">
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="brand-name">AI Browser</span>
        <span className="status-dot" title="Stored locally" />
      </div>
      <div className="dock-divider" />
      <div
        className="dock-context"
        style={{ "--space-color": activeSpace?.color ?? "#9be7c4" } as React.CSSProperties}
      >
        <span className="dock-context-dot" />
        <span>{activeSpace?.name ?? "All Spaces"}</span>
      </div>
      <div className="dock-divider" />
      <div className="dock-navigation">
        <IconButton
          label="Go back"
          onClick={() => dispatchTabCommand("navigation.back")}
          disabled={!activeTab}
        >
          <span>←</span>
        </IconButton>
        <IconButton
          label="Go forward"
          onClick={() => dispatchTabCommand("navigation.forward")}
          disabled={!activeTab}
        >
          <span>→</span>
        </IconButton>
        <IconButton
          label="Reload page"
          onClick={() => dispatchTabCommand("navigation.reload")}
          disabled={!activeTab}
        >
          <span className="reload-glyph">↻</span>
        </IconButton>
      </div>
      <form className="command-form" onSubmit={submit}>
        <span className="command-icon">⌕</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask the web or enter a URL"
          aria-label="Search or enter a URL"
        />
        <span className="command-hint">⌘ L</span>
      </form>
      <div className="dock-actions">
        <IconButton
          label={agentOpen ? "Close Agent" : "Open Agent"}
          onClick={onToggleAgent}
          active={agentOpen}
        >
          <span>✧</span>
        </IconButton>
        <IconButton label="Open Vault" onClick={onOpenVault} active={snapshot.drawer === "vault"}>
          <span>◒</span>
        </IconButton>
        <IconButton
          label="Inspect this site"
          onClick={onOpenSite}
          disabled={!activeTab}
          active={snapshot.drawer === "site"}
        >
          <span>⌾</span>
        </IconButton>
        <IconButton
          label="Bookmark this page"
          onClick={() => {
            if (activeTab) onDispatch({ type: "bookmark.create", tabId: activeTab.id });
          }}
          disabled={!activeTab}
        >
          <span>✦</span>
        </IconButton>
        <IconButton label="New tab" onClick={() => onDispatch({ type: "tab.create" })}>
          <span className="glyph-plus">+</span>
        </IconButton>
      </div>
      <div className="window-controls">
        <WindowButton label="Minimize window" onClick={() => window.windowControls?.minimize()}>
          <span className="minimize-icon" />
        </WindowButton>
        <WindowButton
          label={maximized ? "Restore window" : "Maximize window"}
          onClick={onToggleMaximize}
        >
          <span className={maximized ? "restore-icon" : "maximize-icon"} />
        </WindowButton>
        <WindowButton label="Close window" onClick={() => window.windowControls?.close()} danger>
          <span className="close-icon" />
        </WindowButton>
      </div>
    </section>
  );
}

function TabDeck({
  tabs,
  spaces,
  activeTabId,
  onActivate,
  onClose,
  onHibernate,
  onMoveTab,
}: {
  tabs: Tab[];
  spaces: Space[];
  activeTabId: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onHibernate: (tabId: string) => void;
  onMoveTab: (tabId: string, spaceId: string, clone: boolean) => void;
}) {
  const spaceMap = new Map(spaces.map((space) => [space.id, space]));
  const [moveTabId, setMoveTabId] = useState<string | null>(null);
  return (
    <section className="tab-deck" aria-label="Open tabs">
      <div className="deck-caption">
        <span className="deck-line" />
        {tabs.length} open {tabs.length === 1 ? "surface" : "surfaces"}
      </div>
      <div className="tab-list">
        {tabs.map((tab) => {
          const space = spaceMap.get(tab.spaceId);
          return (
            <div
              className={`tab-card${tab.id === activeTabId ? " is-active" : ""}${tab.status === "hibernated" ? " is-hibernated" : ""}${tab.agentLock ? " is-agent-locked" : ""}`}
              key={tab.id}
            >
              <button
                className="tab-main"
                type="button"
                onClick={() => onActivate(tab.id)}
                disabled={Boolean(tab.agentLock)}
                title={
                  tab.agentLock
                    ? "Agent is using this tab"
                    : `${tab.title} · ${space?.name ?? "Space"}`
                }
              >
                <span
                  className="tab-favicon"
                  style={{ "--space-color": space?.color ?? "#9be7c4" } as React.CSSProperties}
                >
                  {tab.faviconUrl ? (
                    <img src={tab.faviconUrl} alt="" />
                  ) : (
                    <span>{tab.status === "hibernated" ? "z" : "·"}</span>
                  )}
                </span>
                <span className="tab-copy">
                  <strong>{tab.title || "New tab"}</strong>
                  <small>{tab.agentLock ? "Agent is working here" : hostFor(tab.url)}</small>
                </span>
                <span className="tab-space-label">{space?.name ?? "Unknown"}</span>
              </button>
              <span
                className="tab-agent-lock"
                aria-label="Locked by agent"
                title="Agent is using this tab"
              >
                ✦
              </span>
              <button
                className="tab-action tab-move"
                type="button"
                disabled={Boolean(tab.agentLock)}
                onClick={() => setMoveTabId(moveTabId === tab.id ? null : tab.id)}
                aria-label={`Move ${tab.title} to another Space`}
                title="Move or clone tab"
              >
                ↗
              </button>
              <button
                className="tab-action tab-sleep"
                type="button"
                disabled={Boolean(tab.agentLock)}
                onClick={() => onHibernate(tab.id)}
                aria-label={`Hibernate ${tab.title}`}
                title="Hibernate tab"
              >
                z
              </button>
              <button
                className="tab-action"
                type="button"
                disabled={Boolean(tab.agentLock)}
                onClick={() => onClose(tab.id)}
                aria-label={`Close ${tab.title}`}
                title="Close tab"
              >
                ×
              </button>
              {moveTabId === tab.id && (
                <div className="tab-space-menu">
                  <span>Send to another Space</span>
                  {spaces
                    .filter((candidate) => candidate.id !== tab.spaceId)
                    .map((target) => (
                      <div key={target.id} className="tab-space-option">
                        <strong>
                          <i style={{ "--space-color": target.color } as React.CSSProperties} />
                          {target.name}
                        </strong>
                        <button
                          type="button"
                          onClick={() => {
                            onMoveTab(tab.id, target.id, false);
                            setMoveTabId(null);
                          }}
                        >
                          Move
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onMoveTab(tab.id, target.id, true);
                            setMoveTabId(null);
                          }}
                        >
                          Clone
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })}
        <button
          className="new-tab-card"
          type="button"
          onClick={() => onActivate("")}
          aria-label="New tab"
        >
          <span>+</span>
          <small>New</small>
        </button>
      </div>
    </section>
  );
}

function VaultDrawer({
  snapshot,
  onDispatch,
  onClose,
}: {
  snapshot: AppSnapshot;
  onDispatch: (command: BrowserCommand) => void;
  onClose: () => void;
}) {
  const currentSpaceId = snapshot.scope === "all" ? snapshot.activeSpaceId : snapshot.scope;
  const credentials = snapshot.credentials.filter(
    (credential) => credential.spaceId === currentSpaceId,
  );
  const bookmarks = snapshot.bookmarks.filter((bookmark) => bookmark.spaceId === currentSpaceId);
  const sites = snapshot.sites.filter((site) => site.spaceId === currentSpaceId);
  return (
    <aside className="drawer vault-drawer" aria-label="Space Vault">
      <div className="drawer-header">
        <div>
          <span className="eyebrow">SPACE VAULT</span>
          <h2>Things you keep close.</h2>
        </div>
        <IconButton label="Close Vault" onClick={onClose}>
          <span>×</span>
        </IconButton>
      </div>
      {!snapshot.vaultAvailable && (
        <div className="vault-warning">
          <span>!</span>
          <p>
            Secure storage is unavailable. Browsing still works, but credentials cannot be saved or
            autofilled on this system.
          </p>
        </div>
      )}
      <section className="drawer-section">
        <div className="section-heading">
          <span>Credentials</span>
          <small>{credentials.length}</small>
        </div>
        {credentials.length === 0 ? (
          <div className="drawer-empty">
            <span className="empty-icon">◒</span>
            <p>Saved logins for this Space will live here.</p>
          </div>
        ) : (
          <div className="record-list">
            {credentials.map((credential) => (
              <div className="record-card" key={credential.id}>
                <span className="record-mark">@</span>
                <div>
                  <strong>{credential.hostname}</strong>
                  <small>{credential.username || "Unnamed login"}</small>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onDispatch({ type: "credential.fill", credentialId: credential.id })
                  }
                >
                  Fill
                </button>
                <button
                  className="record-delete"
                  type="button"
                  onClick={() =>
                    onDispatch({ type: "credential.remove", credentialId: credential.id })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="drawer-section">
        <div className="section-heading">
          <span>Bookmarks</span>
          <small>{bookmarks.length}</small>
        </div>
        {bookmarks.length === 0 ? (
          <div className="drawer-empty compact">
            <p>Bookmark a page from the command dock.</p>
          </div>
        ) : (
          <div className="record-list">
            {bookmarks.map((bookmark) => (
              <button
                className="bookmark-row"
                key={bookmark.id}
                type="button"
                onClick={() =>
                  onDispatch({ type: "tab.create", spaceId: bookmark.spaceId, url: bookmark.url })
                }
              >
                <span>✦</span>
                <div>
                  <strong>{bookmark.title}</strong>
                  <small>{hostFor(bookmark.url)}</small>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="drawer-section">
        <div className="section-heading">
          <span>Known sites</span>
          <small>{sites.length}</small>
        </div>
        {sites.length === 0 ? (
          <div className="drawer-empty compact">
            <p>As you browse, each Space remembers its site surface here.</p>
          </div>
        ) : (
          <div className="record-list">
            {sites.map((site) => (
              <button
                className="site-row"
                key={site.id}
                type="button"
                onClick={() => onDispatch({ type: "site.inspect", siteId: site.id })}
              >
                <span
                  className="site-status"
                  style={
                    {
                      "--space-color": site.cookieCount > 0 ? "#9be7c4" : "#616a76",
                    } as React.CSSProperties
                  }
                />
                <div>
                  <strong>{site.hostname}</strong>
                  <small>
                    {site.cookieCount > 0
                      ? `${site.cookieCount} session cookie${site.cookieCount === 1 ? "" : "s"}`
                      : "No visible cookies"}
                    {site.credentialCount > 0 ? " · credential saved" : ""}
                  </small>
                </div>
                <span>›</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}

function SiteDrawer({
  snapshot,
  onDispatch,
  onClose,
}: {
  snapshot: AppSnapshot;
  onDispatch: (command: BrowserCommand) => void;
  onClose: () => void;
}) {
  const site = snapshot.sites.find((candidate) => candidate.id === snapshot.selectedSiteId);
  if (!site) return null;
  const bookmarks = snapshot.bookmarks.filter(
    (bookmark) => bookmark.spaceId === site.spaceId && originFor(bookmark.url) === site.origin,
  );
  return (
    <aside className="drawer site-drawer" aria-label={`${site.hostname} site dossier`}>
      <div className="drawer-header">
        <div>
          <span className="eyebrow">SITE DOSSIER</span>
          <h2>{site.hostname}</h2>
          <p className="drawer-origin">{site.origin}</p>
        </div>
        <IconButton label="Close site dossier" onClick={onClose}>
          <span>×</span>
        </IconButton>
      </div>
      <div className="site-hero">
        <span
          className="hero-orb"
          style={
            { "--space-color": site.cookieCount > 0 ? "#9be7c4" : "#8190a3" } as React.CSSProperties
          }
        >
          ◉
        </span>
        <div>
          <strong>{site.cookieCount > 0 ? "Session present" : "No session detected"}</strong>
          <small>Last visited {new Date(site.lastVisitedAt).toLocaleDateString()}</small>
        </div>
      </div>
      <div className="site-stats">
        <div>
          <strong>{site.cookieCount}</strong>
          <small>cookies</small>
        </div>
        <div>
          <strong>{site.storagePresent ? "On" : "Off"}</strong>
          <small>site data</small>
        </div>
        <div>
          <strong>{site.credentialCount}</strong>
          <small>logins</small>
        </div>
      </div>
      <section className="drawer-section">
        <div className="section-heading">
          <span>Controls</span>
        </div>
        <div className="control-stack">
          <button
            type="button"
            onClick={() => onDispatch({ type: "site.clearData", siteId: site.id })}
          >
            <span>⌫</span>
            <div>
              <strong>Clear site data</strong>
              <small>Cookies, cache, storage, and service workers</small>
            </div>
            <span>›</span>
          </button>
          <button
            type="button"
            onClick={() =>
              onDispatch({
                type: "site.forget",
                siteId: site.id,
                clearData: false,
                removeCredentials: true,
              })
            }
          >
            <span>◌</span>
            <div>
              <strong>Remove saved logins</strong>
              <small>Keep website data, remove Vault credentials</small>
            </div>
            <span>›</span>
          </button>
          <button
            type="button"
            onClick={() =>
              onDispatch({
                type: "site.forget",
                siteId: site.id,
                clearData: true,
                removeCredentials: true,
              })
            }
          >
            <span className="danger-glyph">!</span>
            <div>
              <strong>Forget this site</strong>
              <small>Clear data, logins, bookmarks, and site memory</small>
            </div>
            <span>›</span>
          </button>
        </div>
      </section>
      <section className="drawer-section">
        <div className="section-heading">
          <span>Saved here</span>
        </div>
        <div className="site-memory">
          <span>✦</span>
          <p>
            {bookmarks.length > 0 ? "Bookmarked in this Space." : "Not bookmarked in this Space."}
          </p>
        </div>
      </section>
    </aside>
  );
}

function PromptCard({
  request,
  spaceName,
  onDispatch,
}: {
  request: CredentialSaveRequest;
  spaceName: string;
  onDispatch: (command: BrowserCommand) => void;
}) {
  return (
    <div className="credential-prompt">
      <div className="prompt-icon">◒</div>
      <div className="prompt-copy">
        <span className="eyebrow">NEW LOGIN DETECTED</span>
        <strong>Save {request.hostname}?</strong>
        <small>
          {request.username || "A new credential"} · {spaceName}
        </small>
      </div>
      <button
        type="button"
        onClick={() => onDispatch({ type: "credential.save", requestId: request.requestId })}
      >
        Save
      </button>
      <button
        className="prompt-never"
        type="button"
        onClick={() =>
          onDispatch({
            type: "credential.reject",
            requestId: request.requestId,
            neverForSite: true,
          })
        }
      >
        Never
      </button>
      <button
        className="prompt-dismiss"
        type="button"
        onClick={() => onDispatch({ type: "credential.reject", requestId: request.requestId })}
      >
        ×
      </button>
    </div>
  );
}

function EvidencePreview({ id }: { id: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const request = window.agentAPI?.getEvidence(id);
    if (!request)
      return () => {
        active = false;
      };
    void request.then((evidence) => {
      if (active) setDataUrl(evidence?.dataUrl ?? null);
    });
    return () => {
      active = false;
    };
  }, [id]);
  return dataUrl ? (
    <img className="agent-evidence-thumb" src={dataUrl} alt="Agent screenshot evidence" />
  ) : (
    <span className="agent-evidence-loading">evidence</span>
  );
}

// biome-ignore lint/correctness/noUnusedVariables: retained during the staged AgentDock extraction
function AgentDock({
  snapshot,
  browserSnapshot,
  onDispatch,
  onClose,
  onActivateTab,
}: {
  snapshot: AgentSnapshot;
  browserSnapshot: AppSnapshot;
  onDispatch: (command: AgentCommand) => void;
  onClose: () => void;
  onActivateTab: (tabId: string) => void;
}) {
  const [input, setInput] = useState("");
  const [originInput, setOriginInput] = useState("");
  const thread = snapshot.threads.find((candidate) => candidate.id === snapshot.activeThreadId);
  const policy = thread?.policy ?? snapshot.globalDefaults;
  const tabMap = new Map(browserSnapshot.tabs.map((tab) => [tab.id, tab]));
  const spaceMap = new Map(browserSnapshot.spaces.map((space) => [space.id, space]));
  const activeBrowserTab = browserSnapshot.tabs.find(
    (tab) => tab.id === browserSnapshot.activeTabId,
  );
  const isRunning =
    thread?.status === "running" ||
    thread?.status === "starting" ||
    thread?.status === "waiting-for-approval";
  const statusLabel =
    snapshot.connection.status === "ready"
      ? (thread?.status.replace(/-/g, " ") ?? "ready")
      : snapshot.connection.status;

  useEffect(() => {
    setOriginInput("");
  }, [thread?.id]);

  const updatePolicy = (update: Partial<AgentPolicy>): void => {
    if (!thread) return;
    onDispatch({
      type: "agent.policy.update",
      threadId: thread.id,
      policy: { ...policy, ...update },
    });
  };

  const toggleSpace = (spaceId: string): void => {
    const next =
      policy.allowedSpaceIds === null
        ? [spaceId]
        : policy.allowedSpaceIds.includes(spaceId)
          ? policy.allowedSpaceIds.filter((id) => id !== spaceId)
          : [...policy.allowedSpaceIds, spaceId];
    updatePolicy({ allowedSpaceIds: next });
  };

  const toggleTab = (tabId: string): void => {
    const next =
      policy.allowedTabIds === null
        ? [tabId]
        : policy.allowedTabIds.includes(tabId)
          ? policy.allowedTabIds.filter((id) => id !== tabId)
          : [...policy.allowedTabIds, tabId];
    updatePolicy({ allowedTabIds: next });
  };

  const toggleAction = (action: AgentActionClass): void => {
    const next = policy.allowedActions.includes(action)
      ? policy.allowedActions.filter((candidate) => candidate !== action)
      : [...policy.allowedActions, action];
    updatePolicy({ allowedActions: next });
  };

  const addOrigin = (event: FormEvent): void => {
    event.preventDefault();
    const origin = originInput.trim().replace(/\/$/, "");
    if (!origin || !thread) return;
    updatePolicy({
      allowedOrigins: policy.allowedOrigins
        ? [...new Set([...policy.allowedOrigins, origin])]
        : [origin],
    });
    setOriginInput("");
  };

  const send = (): void => {
    if (!thread || !input.trim()) return;
    onDispatch({ type: "agent.message.send", threadId: thread.id, text: input.trim() });
    setInput("");
  };

  const createThread = (): void => onDispatch({ type: "agent.thread.create" });

  return (
    <aside className="agent-dock" aria-label="Agent workspace">
      <div className="agent-header">
        <div>
          <span className="eyebrow">AGENT WORKSPACE</span>
          <h2>Let the browser move.</h2>
        </div>
        <div className="agent-header-actions">
          <span
            className={`agent-status-dot agent-status-${snapshot.connection.status}`}
            title={
              "message" in snapshot.connection
                ? (snapshot.connection.message ?? statusLabel)
                : statusLabel
            }
          />
          <IconButton label="Close Agent" onClick={onClose}>
            <span>×</span>
          </IconButton>
        </div>
      </div>

      <div className="agent-toolbar">
        <button className="agent-new-thread" type="button" onClick={createThread}>
          <span>+</span> New thread
        </button>
        <span className="agent-sharing">
          <i /> Page context on
        </span>
      </div>

      <div className="agent-thread-strip" aria-label="Agent threads">
        {snapshot.threads.slice(0, 6).map((candidate) => (
          <button
            className={`agent-thread-chip${candidate.id === thread?.id ? " is-active" : ""}`}
            key={candidate.id}
            type="button"
            onClick={() => onDispatch({ type: "agent.thread.select", threadId: candidate.id })}
          >
            <span>{candidate.status === "running" ? "◌" : "·"}</span>
            {candidate.title}
          </button>
        ))}
      </div>

      {!thread ? (
        <div className="agent-empty">
          <span className="agent-empty-mark">✧</span>
          <strong>Start a browser thread</strong>
          <p>Give the agent a task and it can work across the Spaces you choose.</p>
          <button type="button" onClick={createThread}>
            Create thread <span>↗</span>
          </button>
        </div>
      ) : (
        <>
          <div className="agent-controls">
            <label className="agent-select-label">
              <span>MODEL</span>
              <select
                value={thread.model}
                onChange={(event) =>
                  onDispatch({
                    type: "agent.model.update",
                    threadId: thread.id,
                    model: event.target.value,
                    reasoningEffort: thread.reasoningEffort,
                  })
                }
                disabled={snapshot.modelOptions.length === 0}
              >
                <option value={thread.model}>{thread.model}</option>
                {snapshot.modelOptions
                  .filter((model) => model.id !== thread.model)
                  .map((model) => (
                    <option value={model.id} key={model.id}>
                      {model.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="agent-select-label">
              <span>MODE</span>
              <select
                value={policy.mode}
                onChange={(event) => updatePolicy({ mode: event.target.value as AgentMode })}
              >
                <option value="full">Full takeover</option>
                <option value="guided">Guided</option>
                <option value="observe">Observe</option>
              </select>
            </label>
            <div className="agent-run-actions">
              <span className="agent-run-state">{statusLabel}</span>
              {isRunning ? (
                <>
                  <button
                    type="button"
                    onClick={() => onDispatch({ type: "agent.run.pause", threadId: thread.id })}
                    title="Pause agent"
                  >
                    Ⅱ
                  </button>
                  <button
                    className="agent-stop"
                    type="button"
                    onClick={() => onDispatch({ type: "agent.run.stop", threadId: thread.id })}
                    title="Stop agent"
                  >
                    ■
                  </button>
                </>
              ) : thread.status === "paused" ? (
                <button
                  type="button"
                  onClick={() => onDispatch({ type: "agent.run.resume", threadId: thread.id })}
                  title="Resume agent"
                >
                  ▶
                </button>
              ) : null}
            </div>
          </div>

          <details className="agent-settings">
            <summary>
              <span>Workspace permissions</span>
              <small>
                {policy.allowedSpaceIds === null
                  ? "Open workspace"
                  : `${policy.allowedSpaceIds.length} Space${policy.allowedSpaceIds.length === 1 ? "" : "s"}`}
              </small>
            </summary>
            <div className="agent-settings-body">
              <div className="agent-setting-row">
                <span>Spaces</span>
                <button
                  className={policy.allowedSpaceIds === null ? "is-selected" : ""}
                  type="button"
                  onClick={() => updatePolicy({ allowedSpaceIds: null })}
                >
                  All persistent
                </button>
              </div>
              <div className="agent-space-toggles">
                {browserSnapshot.spaces.map((space) => (
                  <button
                    key={space.id}
                    type="button"
                    className={policy.allowedSpaceIds?.includes(space.id) ? "is-selected" : ""}
                    onClick={() => toggleSpace(space.id)}
                  >
                    <i style={{ "--space-color": space.color } as React.CSSProperties} />
                    {space.name}
                  </button>
                ))}
              </div>
              <div className="agent-setting-row">
                <span>Vault fills</span>
                <button
                  className={policy.allowVault ? "is-selected" : ""}
                  type="button"
                  onClick={() => updatePolicy({ allowVault: !policy.allowVault })}
                >
                  {policy.allowVault ? "Allowed" : "Blocked"}
                </button>
              </div>
              <div className="agent-setting-row">
                <span>Private context</span>
                <button
                  className={policy.allowPrivate ? "is-selected" : ""}
                  type="button"
                  onClick={() => updatePolicy({ allowPrivate: !policy.allowPrivate })}
                >
                  {policy.allowPrivate ? "Allowed" : "Blocked"}
                </button>
              </div>
              <div className="agent-setting-row">
                <span>Tabs</span>
                <button
                  className={policy.allowedTabIds === null ? "is-selected" : ""}
                  type="button"
                  onClick={() => updatePolicy({ allowedTabIds: null })}
                >
                  All in scope
                </button>
              </div>
              <div className="agent-space-toggles agent-tab-toggles">
                {browserSnapshot.tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={policy.allowedTabIds?.includes(tab.id) ? "is-selected" : ""}
                    onClick={() => toggleTab(tab.id)}
                  >
                    <span>{tab.title || hostFor(tab.url)}</span>
                    <small>{spaceMap.get(tab.spaceId)?.name ?? "Space"}</small>
                  </button>
                ))}
              </div>
              <div className="agent-setting-row">
                <span>Action classes</span>
                <button
                  type="button"
                  onClick={() =>
                    updatePolicy({
                      allowedActions: [...emptyAgentSnapshot.globalDefaults.allowedActions],
                    })
                  }
                >
                  Allow all
                </button>
              </div>
              <div className="agent-space-toggles agent-action-toggles">
                {agentActionOptions.map(([action, label]) => (
                  <button
                    key={action}
                    type="button"
                    className={policy.allowedActions.includes(action) ? "is-selected" : ""}
                    onClick={() => toggleAction(action)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="agent-setting-row">
                <span>Tab limit</span>
                <select
                  value={policy.maxTabs}
                  onChange={(event) => updatePolicy({ maxTabs: Number(event.target.value) })}
                >
                  <option value="4">4 tabs</option>
                  <option value="8">8 tabs</option>
                  <option value="16">16 tabs</option>
                  <option value="24">24 tabs</option>
                  <option value="48">48 tabs</option>
                </select>
              </div>
              <form className="agent-origin-form" onSubmit={addOrigin}>
                <input
                  value={originInput}
                  onChange={(event) => setOriginInput(event.target.value)}
                  placeholder="Limit to an origin"
                  aria-label="Add allowed origin"
                />
                <button type="submit">Add</button>
              </form>
              {policy.allowedOrigins && policy.allowedOrigins.length > 0 && (
                <div className="agent-origin-list">
                  {policy.allowedOrigins.map((origin) => (
                    <button
                      key={origin}
                      type="button"
                      onClick={() =>
                        updatePolicy({
                          allowedOrigins:
                            policy.allowedOrigins?.filter((candidate) => candidate !== origin) ??
                            null,
                        })
                      }
                    >
                      {origin} ×
                    </button>
                  ))}
                </div>
              )}
            </div>
          </details>

          <div className="agent-target-card">
            <span className="agent-target-icon">◉</span>
            <div>
              <span>VISIBLE TARGET</span>
              <strong>{activeBrowserTab?.title || "No active tab"}</strong>
              <small>
                {activeBrowserTab
                  ? `${spaceMap.get(activeBrowserTab.spaceId)?.name ?? "Space"} · ${activeBrowserTab.url}`
                  : "The agent will choose a tab when needed."}
              </small>
            </div>
          </div>

          <div className="agent-conversation" aria-live="polite">
            {snapshot.messages.length === 0 && (
              <div className="agent-suggestion">
                <span>Try</span>
                <p>“Open a new tab in Personal and search for a quiet place to work.”</p>
              </div>
            )}
            {snapshot.messages.map((message) => (
              <div className={`agent-message agent-message-${message.role}`} key={message.id}>
                <span className="agent-message-mark">
                  {message.role === "user" ? "You" : message.role === "assistant" ? "AI" : "·"}
                </span>
                <div className="agent-message-body">
                  <p>{message.text || "…"}</p>
                  {message.evidenceIds && (
                    <div className="agent-evidence-list">
                      {message.evidenceIds.map((id) => (
                        <EvidencePreview id={id} key={id} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {snapshot.approvalRequests.map((request) => (
              <div className="agent-approval" key={request.id}>
                <span className="eyebrow">YOUR APPROVAL</span>
                <strong>{request.summary}</strong>
                <small>
                  {request.actionClass.replace(/-/g, " ")}
                  {request.tabId && tabMap.get(request.tabId)
                    ? ` · ${tabMap.get(request.tabId)?.title}`
                    : ""}
                </small>
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      onDispatch({
                        type: "agent.approval.respond",
                        threadId: request.threadId,
                        approvalId: request.id,
                        approved: true,
                      })
                    }
                  >
                    Allow once
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onDispatch({
                        type: "agent.approval.respond",
                        threadId: request.threadId,
                        approvalId: request.id,
                        approved: false,
                      })
                    }
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>

          {snapshot.actions.length > 0 && (
            <div className="agent-trace">
              <div className="agent-trace-heading">
                <span>LIVE TRACE</span>
                <small>{snapshot.actions.length} actions</small>
              </div>
              {snapshot.actions.slice(-5).map((action) => (
                <button
                  type="button"
                  className="agent-trace-row"
                  key={action.id}
                  onClick={() => action.tabId && onActivateTab(action.tabId)}
                >
                  <i className={`trace-status trace-${action.status}`} />
                  <span>{action.summary}</span>
                  <small>{action.status}</small>
                </button>
              ))}
            </div>
          )}

          <form
            className="agent-composer"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={
                policy.mode === "observe"
                  ? "Ask the agent to inspect…"
                  : "Tell the agent what to do…"
              }
              aria-label="Message the agent"
              rows={2}
            />
            <button type="submit" disabled={!input.trim() || isRunning}>
              Send <span>↗</span>
            </button>
            <small>Agent mode is {policy.mode}; page context sharing is on.</small>
          </form>
        </>
      )}
    </aside>
  );
}

function AgentCommandCenter({
  snapshot,
  browserSnapshot,
  onDispatch,
  onClose,
  onActivateTab,
}: {
  snapshot: AgentSnapshot;
  browserSnapshot: AppSnapshot;
  onDispatch: (command: AgentCommand) => void;
  onClose: () => void;
  onActivateTab: (tabId: string) => void;
}) {
  const [input, setInput] = useState("");
  const [threadQuery, setThreadQuery] = useState("");
  const [showThreads, setShowThreads] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const thread = snapshot.threads.find((candidate) => candidate.id === snapshot.activeThreadId);
  const policy = thread?.policy ?? snapshot.globalDefaults;
  const tabMap = new Map(browserSnapshot.tabs.map((tab) => [tab.id, tab]));
  const activeTab = browserSnapshot.tabs.find((tab) => tab.id === browserSnapshot.activeTabId);
  const isRunning =
    thread?.status === "running" ||
    thread?.status === "starting" ||
    thread?.status === "waiting-for-approval";
  const filteredThreads = snapshot.threads.filter((candidate) =>
    candidate.title.toLowerCase().includes(threadQuery.toLowerCase()),
  );
  const lockedTabs = browserSnapshot.tabs.filter((tab) => tab.agentLock);

  const updatePolicy = (update: Partial<AgentPolicy>): void => {
    if (thread)
      onDispatch({
        type: "agent.policy.update",
        threadId: thread.id,
        policy: { ...policy, ...update },
      });
  };
  const send = (): void => {
    if (!thread || !input.trim() || isRunning) return;
    onDispatch({ type: "agent.message.send", threadId: thread.id, text: input.trim() });
    setInput("");
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragRef.current) return;
    setPosition({
      x: dragRef.current.originX + event.clientX - dragRef.current.x,
      y: dragRef.current.originY + event.clientY - dragRef.current.y,
    });
  };
  const stopDrag = (): void => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopDrag);
  };
  const startDrag = (event: React.PointerEvent): void => {
    if ((event.target as HTMLElement).closest("button")) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
  };
  useEffect(() => () => stopDrag(), []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  useEffect(() => {
    if (!thread) return;
    const focusFrame = window.requestAnimationFrame(() => composerRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [thread?.id]);

  return (
    <aside
      className={`agent-center${expanded ? " is-expanded" : ""}`}
      style={
        { "--agent-x": `${position.x}px`, "--agent-y": `${position.y}px` } as React.CSSProperties
      }
      aria-label="Agent command center"
      role="dialog"
      aria-modal="false"
    >
      <header className="agent-center-header" onPointerDown={startDrag}>
        <div className="agent-identity">
          <span className="agent-orbit">
            <i />
            <i />
            <i />
          </span>
          <div>
            <span className="eyebrow">AGENT MODE</span>
            <h2>Command center</h2>
          </div>
        </div>
        <div className="agent-center-actions">
          <span className={`agent-live-status ${isRunning ? "is-working" : ""}`}>
            <i className="agent-live-dot" />
            <span>{isRunning ? "Working" : "Ready"}</span>
          </span>
          <button
            className="agent-header-action"
            type="button"
            aria-label={expanded ? "Use focused layout" : "Expand command center"}
            title={expanded ? "Use focused layout" : "Expand command center"}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "↙" : "↗"}
          </button>
          <button
            className="agent-header-close"
            type="button"
            aria-label="Close command center"
            title="Close command center"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>

      <div className="agent-mode-banner">
        <div>
          <strong>{isRunning ? "Working across your browser" : "Ready when you are"}</strong>
          <small>
            {lockedTabs.length
              ? `${lockedTabs.length} tab${lockedTabs.length === 1 ? "" : "s"} protected while I work`
              : "Your tabs stay yours until you give me a task"}
          </small>
        </div>
        <span className="agent-banner-spark">✦</span>
      </div>

      <div className="agent-center-body">
        {showThreads && (
          <nav className="agent-thread-panel" aria-label="Agent threads">
            <div className="thread-panel-head">
              <div>
                <span className="eyebrow">THREADS</span>
                <strong>{snapshot.threads.length} conversations</strong>
              </div>
              <button type="button" onClick={() => onDispatch({ type: "agent.thread.create" })}>
                ＋
              </button>
            </div>
            <label className="thread-search">
              <span>⌕</span>
              <input
                value={threadQuery}
                onChange={(event) => setThreadQuery(event.target.value)}
                placeholder="Find a thread"
                aria-label="Find a thread"
              />
            </label>
            <div className="thread-list">
              {filteredThreads.length === 0 ? (
                <small className="thread-empty">No matching threads</small>
              ) : (
                filteredThreads.map((candidate) => (
                  <div
                    className={`thread-row${candidate.id === thread?.id ? " is-active" : ""}`}
                    key={candidate.id}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onDispatch({ type: "agent.thread.select", threadId: candidate.id })
                      }
                    >
                      <span className={`thread-state state-${candidate.status}`} />{" "}
                      <span>
                        <strong>{candidate.title}</strong>
                        <small>
                          {candidate.status === "idle"
                            ? "Ready"
                            : candidate.status.replace(/-/g, " ")}
                        </small>
                      </span>
                    </button>
                    <div className="thread-row-actions">
                      <button
                        type="button"
                        title="Rename thread"
                        onClick={() => {
                          const title = window.prompt("Rename thread", candidate.title)?.trim();
                          if (title)
                            onDispatch({
                              type: "agent.thread.rename",
                              threadId: candidate.id,
                              title,
                            });
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title="Delete thread"
                        onClick={() => {
                          if (window.confirm(`Delete ${candidate.title}?`))
                            onDispatch({ type: "agent.thread.delete", threadId: candidate.id });
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="thread-panel-foot">
              <span>LOCAL THREAD MEMORY</span>
              <button type="button" onClick={() => setShowThreads(false)}>
                Hide panel
              </button>
            </div>
          </nav>
        )}

        <section className="agent-chat-panel">
          <div className="agent-chat-top">
            <button
              className="thread-toggle"
              type="button"
              onClick={() => setShowThreads((value) => !value)}
              title="Show or hide threads"
            >
              ☰
            </button>
            <div className="active-thread-title">
              <span className="eyebrow">ACTIVE THREAD</span>
              <strong>{thread?.title ?? "New browser task"}</strong>
            </div>
            {thread && (
              <span className={`mode-pill mode-${policy.mode}`}>
                {policy.mode === "full" ? "Autonomous" : policy.mode}
              </span>
            )}
          </div>
          {!thread ? (
            <div className="agent-chat-empty">
              <span className="agent-empty-mark">✦</span>
              <h3>Give the browser a job.</h3>
              <p>
                Create a thread, then tell me what you want to accomplish. I’ll keep the active tab
                protected while I work.
              </p>
              <button type="button" onClick={() => onDispatch({ type: "agent.thread.create" })}>
                Start a thread <span>↗</span>
              </button>
            </div>
          ) : (
            <>
              <div className="agent-context-line">
                <span className="context-pulse" />
                Using <strong>{activeTab?.title || "current browser context"}</strong>
                <small>{activeTab?.agentLock ? "protected" : "context shared"}</small>
              </div>
              <div className="agent-conversation" aria-live="polite">
                {snapshot.messages.length === 0 && (
                  <div className="agent-welcome">
                    <span className="agent-welcome-mark">✦</span>
                    <div>
                      <strong>What should I take care of?</strong>
                      <p>
                        Research, compare, fill, organize — you stay in control of approvals and
                        sensitive actions.
                      </p>
                    </div>
                  </div>
                )}
                {snapshot.messages.map((message) => (
                  <div className={`agent-message agent-message-${message.role}`} key={message.id}>
                    <span className="agent-message-mark">
                      {message.role === "user" ? "You" : message.role === "assistant" ? "AI" : "·"}
                    </span>
                    <div className="agent-message-body">
                      <p>{message.text || "…"}</p>
                      {message.evidenceIds && (
                        <div className="agent-evidence-list">
                          {message.evidenceIds.map((id) => (
                            <EvidencePreview id={id} key={id} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {snapshot.approvalRequests.map((request) => (
                  <div className="agent-approval" key={request.id}>
                    <span className="eyebrow">NEEDS YOUR APPROVAL</span>
                    <strong>{request.summary}</strong>
                    <small>
                      {request.actionClass.replace(/-/g, " ")}
                      {request.tabId && tabMap.get(request.tabId)
                        ? ` · ${tabMap.get(request.tabId)?.title}`
                        : ""}
                    </small>
                    <div>
                      <button
                        type="button"
                        onClick={() =>
                          onDispatch({
                            type: "agent.approval.respond",
                            threadId: request.threadId,
                            approvalId: request.id,
                            approved: true,
                          })
                        }
                      >
                        Allow once
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onDispatch({
                            type: "agent.approval.respond",
                            threadId: request.threadId,
                            approvalId: request.id,
                            approved: false,
                          })
                        }
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {snapshot.actions.length > 0 && (
                <div className="agent-trace">
                  <div className="agent-trace-heading">
                    <span>LIVE ACTIVITY</span>
                    <small>{snapshot.actions.length} actions</small>
                  </div>
                  {snapshot.actions.slice(-4).map((action) => (
                    <button
                      type="button"
                      className="agent-trace-row"
                      key={action.id}
                      onClick={() => action.tabId && onActivateTab(action.tabId)}
                    >
                      <i className={`trace-status trace-${action.status}`} />
                      <span>{action.summary}</span>
                      <small>{action.status}</small>
                    </button>
                  ))}
                </div>
              )}
              <form
                className="agent-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <textarea
                  ref={composerRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      send();
                    }
                  }}
                  placeholder={
                    policy.mode === "observe" ? "Ask me to inspect…" : "Tell me what to do…"
                  }
                  aria-label="Message the agent"
                  rows={2}
                />
                <button type="submit" disabled={!input.trim() || isRunning}>
                  Run <span>↗</span>
                </button>
                <small>
                  ⌘↵ to run ·{" "}
                  {snapshot.connection.status === "ready"
                    ? "connected"
                    : snapshot.connection.status}
                </small>
              </form>
            </>
          )}
        </section>
      </div>
      {thread && (
        <details className="agent-advanced">
          <summary>
            <span>Advanced controls</span>
            <small>
              {policy.mode} · {thread.model}
            </small>
          </summary>
          <div className="advanced-grid">
            <label>
              Mode
              <select
                value={policy.mode}
                onChange={(event) => updatePolicy({ mode: event.target.value as AgentMode })}
              >
                <option value="full">Autonomous</option>
                <option value="guided">Guided</option>
                <option value="observe">Observe only</option>
              </select>
            </label>
            <label>
              Reasoning
              <select
                value={thread.reasoningEffort}
                onChange={(event) =>
                  onDispatch({
                    type: "agent.model.update",
                    threadId: thread.id,
                    model: thread.model,
                    reasoningEffort: event.target.value as "low" | "medium" | "high",
                  })
                }
              >
                <option value="low">Low</option>
                <option value="medium">Balanced</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="advanced-wide">
              Workspace access
              <button
                type="button"
                onClick={() =>
                  updatePolicy({ allowedSpaceIds: policy.allowedSpaceIds === null ? [] : null })
                }
              >
                {policy.allowedSpaceIds === null
                  ? "All persistent Spaces"
                  : `${policy.allowedSpaceIds.length} selected Spaces`}
              </button>
            </label>
          </div>
        </details>
      )}
    </aside>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot);
  const [runtimeStatus, setRuntimeStatus] = useState<BrowserRuntimeStatus>(emptyRuntimeStatus);
  const [agentSnapshot, setAgentSnapshot] = useState<AgentSnapshot>(emptyAgentSnapshot);
  const [maximized, setMaximized] = useState(false);
  const [drawer, setDrawer] = useState<"vault" | "site" | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [credentialPrompt, setCredentialPrompt] = useState<
    Extract<BrowserEvent, { type: "credential-save-request" }>["request"] | null
  >(null);
  const [toast, setToast] = useState<{
    tone: "info" | "success" | "error";
    message: string;
  } | null>(null);
  const [spaceMenuId, setSpaceMenuId] = useState<string | null>(null);
  const [spaceDialogOpen, setSpaceDialogOpen] = useState(false);
  const [spaceName, setSpaceName] = useState("");
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const browser = window.browserAPI;
    if (!browser) return;
    void browser.getSnapshot().then(setSnapshot);
    return browser.subscribe((event) => {
      if (event.type === "snapshot") setSnapshot(event.snapshot);
      if (event.type === "runtime-status") setRuntimeStatus(event.status);
      if (event.type === "credential-save-request") setCredentialPrompt(event.request);
      if (event.type === "toast") {
        setToast({ tone: event.tone, message: event.message });
        window.setTimeout(() => setToast(null), 3600);
      }
    });
  }, []);

  useEffect(() => {
    const agent = window.agentAPI;
    if (!agent) return;
    void agent.getSnapshot().then(setAgentSnapshot);
    return agent.subscribe((event: AgentEvent) => {
      if (event.type === "agent.snapshot") setAgentSnapshot(event.snapshot);
      if (event.type === "agent.connection")
        setAgentSnapshot((current) => ({ ...current, connection: event.connection }));
    });
  }, []);

  useEffect(() => {
    if (window.windowControls) void window.windowControls.isMaximized().then(setMaximized);
  }, []);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element || !window.browserAPI) return;
    const updateBounds = (): void => {
      const bounds = element.getBoundingClientRect();
      window.browserAPI.setBrowserViewport({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      });
    };
    const observer = new ResizeObserver(updateBounds);
    observer.observe(element);
    updateBounds();
    return () => observer.disconnect();
  }, [drawer]);

  const dispatch = (command: BrowserCommand): void => {
    if (command.type === "credential.reject") setCredentialPrompt(null);
    void window.browserAPI?.dispatch(command).then((result) => {
      if (command.type === "credential.save" && result?.ok) setCredentialPrompt(null);
      if (!result.ok) setToast({ tone: "error", message: result.error });
      else setSnapshot(result.snapshot);
    });
  };

  const dispatchAgent = (command: AgentCommand): void => {
    const request = window.agentAPI?.dispatch(command);
    if (!request) return;
    void request.then((result) => {
      if (!result) return;
      setAgentSnapshot(result.snapshot);
      if (!result.ok) setToast({ tone: "error", message: result.error });
    });
  };

  const activeTab = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
  const activeSpace = snapshot.spaces.find((space) => space.id === snapshot.activeSpaceId);
  const visibleTabs = useMemo(
    () =>
      snapshot.scope === "all"
        ? snapshot.tabs
        : snapshot.tabs.filter((tab) => tab.spaceId === snapshot.scope),
    [snapshot.tabs, snapshot.scope],
  );
  const promptSpace = snapshot.spaces.find((space) => space.id === credentialPrompt?.spaceId);

  const selectScope = (scope: SpaceScope): void => {
    setSpaceMenuId(null);
    dispatch({ type: "space.select", scope });
  };

  const openSite = (): void => {
    if (!activeTab) return;
    const origin = originFor(activeTab.url);
    const site = snapshot.sites.find(
      (candidate) => candidate.spaceId === activeTab.spaceId && candidate.origin === origin,
    );
    if (!site) {
      setToast({ tone: "info", message: "This site is still being catalogued" });
      return;
    }
    dispatch({ type: "site.inspect", siteId: site.id });
    setDrawer("site");
  };

  const openSiteFromVault = (siteId: string): void => {
    dispatch({ type: "site.inspect", siteId });
    setDrawer("site");
  };

  const createSpace = (event: FormEvent): void => {
    event.preventDefault();
    if (!spaceName.trim()) return;
    dispatch({ type: "space.create", name: spaceName.trim() });
    setSpaceName("");
    setSpaceDialogOpen(false);
  };

  const renameSpace = (space: Space): void => {
    const name = window.prompt("Rename Space", space.name)?.trim();
    if (name) dispatch({ type: "space.rename", spaceId: space.id, name });
    setSpaceMenuId(null);
  };

  const deleteSpace = (space: Space): void => {
    if (
      window.confirm(
        `Delete ${space.name}? Its tabs, bookmarks, site memory, and session will be removed.`,
      )
    )
      dispatch({ type: "space.delete", spaceId: space.id });
    setSpaceMenuId(null);
  };

  return (
    <main className="app-shell" onClick={() => spaceMenuId && setSpaceMenuId(null)}>
      <div className="canvas">
        <SpaceRail
          snapshot={snapshot}
          onScope={selectScope}
          onCreate={() => setSpaceDialogOpen(true)}
          onPrivate={() => dispatch({ type: "space.createPrivate" })}
          onSpaceMenu={(spaceId) => {
            setSpaceMenuId(spaceId);
          }}
          menuSpaceId={spaceMenuId}
          onRename={renameSpace}
          onDelete={deleteSpace}
        />
        <CommandDock
          snapshot={{ ...snapshot, drawer }}
          activeTab={activeTab}
          activeSpace={activeSpace}
          maximized={maximized}
          agentOpen={agentOpen}
          onDispatch={dispatch}
          onOpenVault={() => setDrawer(drawer === "vault" ? null : "vault")}
          onOpenSite={openSite}
          onToggleAgent={() => setAgentOpen((current) => !current)}
          onToggleMaximize={() => {
            window.windowControls?.toggleMaximize();
            setMaximized((current) => !current);
          }}
        />
        <TabDeck
          tabs={visibleTabs}
          spaces={snapshot.spaces}
          activeTabId={snapshot.activeTabId}
          onActivate={(tabId) =>
            tabId ? dispatch({ type: "tab.activate", tabId }) : dispatch({ type: "tab.create" })
          }
          onClose={(tabId) => dispatch({ type: "tab.close", tabId })}
          onHibernate={(tabId) => dispatch({ type: "tab.hibernate", tabId })}
          onMoveTab={(tabId, spaceId, clone) =>
            dispatch(
              clone
                ? { type: "tab.cloneToSpace", tabId, spaceId }
                : { type: "tab.moveToSpace", tabId, spaceId },
            )
          }
        />
        <div
          ref={viewportRef}
          className={`browser-viewport${drawer ? " has-drawer" : ""}`}
          aria-label="Browser surface"
        >
          {!activeTab && (
            <div className="viewport-fallback">
              <span className="fallback-orb">✦</span>
              <strong>Choose a surface</strong>
              <small>Open a tab or select a Space to begin.</small>
            </div>
          )}
        </div>
        <BottomStatusToolbar
          snapshot={snapshot}
          runtimeStatus={runtimeStatus}
          agentSnapshot={agentSnapshot}
          activeTab={activeTab}
          activeSpace={activeSpace}
        />
        {drawer === "vault" && (
          <VaultDrawer
            snapshot={snapshot}
            onDispatch={(command) => {
              if (command.type === "site.inspect") openSiteFromVault(command.siteId);
              else dispatch(command);
            }}
            onClose={() => setDrawer(null)}
          />
        )}
        {drawer === "site" && (
          <SiteDrawer
            snapshot={{ ...snapshot, drawer: "site" }}
            onDispatch={dispatch}
            onClose={() => setDrawer(null)}
          />
        )}
        {agentOpen && (
          <div className="agent-layer">
            <AgentCommandCenter
              snapshot={agentSnapshot}
              browserSnapshot={snapshot}
              onDispatch={dispatchAgent}
              onClose={() => setAgentOpen(false)}
              onActivateTab={(tabId) => dispatch({ type: "tab.activate", tabId })}
            />
          </div>
        )}
        {credentialPrompt && promptSpace && (
          <PromptCard
            request={credentialPrompt}
            spaceName={promptSpace.name}
            onDispatch={dispatch}
          />
        )}
        {toast && (
          <div className={`toast toast-${toast.tone}`} role="status">
            <span>{toast.tone === "error" ? "!" : "✓"}</span>
            {toast.message}
          </div>
        )}
      </div>

      {spaceDialogOpen && (
        <div className="modal-scrim" role="presentation">
          <form className="space-dialog" onSubmit={createSpace}>
            <span className="eyebrow">NEW CONTEXT</span>
            <h2>Give this Space a name.</h2>
            <p>A new isolated session will be created for it.</p>
            <input
              autoFocus
              value={spaceName}
              onChange={(event) => setSpaceName(event.target.value)}
              placeholder="e.g. Research, Studio, Finance"
              aria-label="Space name"
            />
            <div className="dialog-actions">
              <button type="button" onClick={() => setSpaceDialogOpen(false)}>
                Cancel
              </button>
              <button className="primary-button" type="submit">
                Create Space <span>↗</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Renderer root element is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
