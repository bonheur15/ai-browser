import { StrictMode, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type {
  AppSnapshot,
  BrowserCommand,
  BrowserEvent,
  CredentialSaveRequest,
  Space,
  SpaceScope,
  Tab,
} from "../shared/contracts";
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

const iconFor = (icon: string): string => ({
  home: "⌂",
  briefcase: "▣",
  eye: "◉",
  "eye-off": "◌",
  sparkles: "✦",
}[icon] ?? "✦");

const hostFor = (value: string): string => {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "") || "New tab";
  } catch {
    return "New tab";
  }
};

const originFor = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

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
    <button className={`window-button${danger ? " window-button-danger" : ""}`} type="button" aria-label={label} onClick={onClick}>
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
    <button className={`icon-button${active ? " is-active" : ""}`} type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
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
  const tabsIn = (spaceId: string): number => snapshot.tabs.filter((tab) => tab.spaceId === spaceId).length;

  return (
    <aside className="space-rail" aria-label="Spaces">
      <button className={`scope-orb${snapshot.scope === "all" ? " is-active" : ""}`} type="button" onClick={() => onScope("all")} title="All Spaces">
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
              <span className="space-icon" style={{ "--space-color": space.color } as React.CSSProperties}>{iconFor(space.icon)}</span>
              <span className="space-name">{space.name}</span>
              <span className="space-count">{tabsIn(space.id)}</span>
            </button>
            <button className="space-more" type="button" aria-label={`Actions for ${space.name}`} onClick={() => onSpaceMenu(space.id)}>•••</button>
            {menuSpaceId === space.id && (
              <div className="space-menu">
                <button type="button" onClick={() => onRename(space)}>Rename Space</button>
                <button type="button" onClick={() => onDelete(space)}>Delete Space</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="rail-actions">
        <IconButton label="Create a new Space" onClick={onCreate}><span className="glyph-plus">+</span></IconButton>
        <IconButton label="Open a temporary Private Space" onClick={onPrivate}><span className="glyph-private">◌</span></IconButton>
      </div>
      <div className="rail-footnote">LOCAL<br />FIRST</div>
    </aside>
  );
}

function CommandDock({
  snapshot,
  activeTab,
  activeSpace,
  onDispatch,
  onOpenVault,
  onOpenSite,
}: {
  snapshot: AppSnapshot;
  activeTab: Tab | undefined;
  activeSpace: Space | undefined;
  onDispatch: (command: BrowserCommand) => void;
  onOpenVault: () => void;
  onOpenSite: () => void;
}) {
  const [input, setInput] = useState(activeTab?.url ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInput(activeTab?.url ?? "");
  }, [activeTab?.id]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (event.key === "Escape" && document.activeElement === inputRef.current) inputRef.current?.blur();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onDispatch({ type: "navigation.search", tabId: activeTab?.id, input });
  };

  return (
    <section className="command-dock" aria-label="Command dock">
      <div className="dock-context" style={{ "--space-color": activeSpace?.color ?? "#9be7c4" } as React.CSSProperties}>
        <span className="dock-context-dot" />
        <span>{activeSpace?.name ?? "All Spaces"}</span>
      </div>
      <div className="dock-divider" />
      <div className="dock-navigation">
        <IconButton label="Go back" onClick={() => onDispatch({ type: "navigation.back", tabId: activeTab?.id })} disabled={!activeTab}><span>←</span></IconButton>
        <IconButton label="Go forward" onClick={() => onDispatch({ type: "navigation.forward", tabId: activeTab?.id })} disabled={!activeTab}><span>→</span></IconButton>
        <IconButton label="Reload page" onClick={() => onDispatch({ type: "navigation.reload", tabId: activeTab?.id })} disabled={!activeTab}><span className="reload-glyph">↻</span></IconButton>
      </div>
      <form className="command-form" onSubmit={submit}>
        <span className="command-icon">⌕</span>
        <input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask the web or enter a URL" aria-label="Search or enter a URL" />
        <span className="command-hint">⌘ L</span>
      </form>
      <div className="dock-actions">
        <IconButton label="Open Vault" onClick={onOpenVault} active={snapshot.drawer === "vault"}><span>◒</span></IconButton>
        <IconButton label="Inspect this site" onClick={onOpenSite} disabled={!activeTab} active={snapshot.drawer === "site"}><span>⌾</span></IconButton>
        <IconButton label="Bookmark this page" onClick={() => onDispatch({ type: "bookmark.create", tabId: activeTab?.id })} disabled={!activeTab}><span>✦</span></IconButton>
        <IconButton label="New tab" onClick={() => onDispatch({ type: "tab.create" })}><span className="glyph-plus">+</span></IconButton>
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
      <div className="deck-caption"><span className="deck-line" />{tabs.length} open {tabs.length === 1 ? "surface" : "surfaces"}</div>
      <div className="tab-list">
        {tabs.map((tab) => {
          const space = spaceMap.get(tab.spaceId);
          return (
            <div className={`tab-card${tab.id === activeTabId ? " is-active" : ""}${tab.status === "hibernated" ? " is-hibernated" : ""}`} key={tab.id}>
              <button className="tab-main" type="button" onClick={() => onActivate(tab.id)} title={`${tab.title} · ${space?.name ?? "Space"}`}>
                <span className="tab-favicon" style={{ "--space-color": space?.color ?? "#9be7c4" } as React.CSSProperties}>{tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : <span>{tab.status === "hibernated" ? "z" : "·"}</span>}</span>
                <span className="tab-copy"><strong>{tab.title || "New tab"}</strong><small>{hostFor(tab.url)}</small></span>
                <span className="tab-space-label">{space?.name ?? "Unknown"}</span>
              </button>
              <button className="tab-action tab-move" type="button" onClick={() => setMoveTabId(moveTabId === tab.id ? null : tab.id)} aria-label={`Move ${tab.title} to another Space`} title="Move or clone tab">↗</button>
              <button className="tab-action tab-sleep" type="button" onClick={() => onHibernate(tab.id)} aria-label={`Hibernate ${tab.title}`} title="Hibernate tab">z</button>
              <button className="tab-action" type="button" onClick={() => onClose(tab.id)} aria-label={`Close ${tab.title}`} title="Close tab">×</button>
              {moveTabId === tab.id && <div className="tab-space-menu"><span>Send to another Space</span>{spaces.filter((candidate) => candidate.id !== tab.spaceId).map((target) => <div key={target.id} className="tab-space-option"><strong><i style={{ "--space-color": target.color } as React.CSSProperties} />{target.name}</strong><button type="button" onClick={() => { onMoveTab(tab.id, target.id, false); setMoveTabId(null); }}>Move</button><button type="button" onClick={() => { onMoveTab(tab.id, target.id, true); setMoveTabId(null); }}>Clone</button></div>)}</div>}
            </div>
          );
        })}
        <button className="new-tab-card" type="button" onClick={() => onActivate("")} aria-label="New tab"><span>+</span><small>New</small></button>
      </div>
    </section>
  );
}

function VaultDrawer({ snapshot, onDispatch, onClose }: { snapshot: AppSnapshot; onDispatch: (command: BrowserCommand) => void; onClose: () => void }) {
  const currentSpaceId = snapshot.scope === "all" ? snapshot.activeSpaceId : snapshot.scope;
  const credentials = snapshot.credentials.filter((credential) => credential.spaceId === currentSpaceId);
  const bookmarks = snapshot.bookmarks.filter((bookmark) => bookmark.spaceId === currentSpaceId);
  const sites = snapshot.sites.filter((site) => site.spaceId === currentSpaceId);
  return (
    <aside className="drawer vault-drawer" aria-label="Space Vault">
      <div className="drawer-header"><div><span className="eyebrow">SPACE VAULT</span><h2>Things you keep close.</h2></div><IconButton label="Close Vault" onClick={onClose}><span>×</span></IconButton></div>
      {!snapshot.vaultAvailable && <div className="vault-warning"><span>!</span><p>Secure storage is unavailable. Browsing still works, but credentials cannot be saved or autofilled on this system.</p></div>}
      <section className="drawer-section"><div className="section-heading"><span>Credentials</span><small>{credentials.length}</small></div>{credentials.length === 0 ? <div className="drawer-empty"><span className="empty-icon">◒</span><p>Saved logins for this Space will live here.</p></div> : <div className="record-list">{credentials.map((credential) => <div className="record-card" key={credential.id}><span className="record-mark">@</span><div><strong>{credential.hostname}</strong><small>{credential.username || "Unnamed login"}</small></div><button type="button" onClick={() => onDispatch({ type: "credential.fill", credentialId: credential.id })}>Fill</button><button className="record-delete" type="button" onClick={() => onDispatch({ type: "credential.remove", credentialId: credential.id })}>×</button></div>)}</div>}</section>
      <section className="drawer-section"><div className="section-heading"><span>Bookmarks</span><small>{bookmarks.length}</small></div>{bookmarks.length === 0 ? <div className="drawer-empty compact"><p>Bookmark a page from the command dock.</p></div> : <div className="record-list">{bookmarks.map((bookmark) => <button className="bookmark-row" key={bookmark.id} type="button" onClick={() => onDispatch({ type: "tab.create", spaceId: bookmark.spaceId, url: bookmark.url })}><span>✦</span><div><strong>{bookmark.title}</strong><small>{hostFor(bookmark.url)}</small></div></button>)}</div>}</section>
      <section className="drawer-section"><div className="section-heading"><span>Known sites</span><small>{sites.length}</small></div>{sites.length === 0 ? <div className="drawer-empty compact"><p>As you browse, each Space remembers its site surface here.</p></div> : <div className="record-list">{sites.map((site) => <button className="site-row" key={site.id} type="button" onClick={() => onDispatch({ type: "site.inspect", siteId: site.id })}><span className="site-status" style={{ "--space-color": site.cookieCount > 0 ? "#9be7c4" : "#616a76" } as React.CSSProperties} /><div><strong>{site.hostname}</strong><small>{site.cookieCount > 0 ? `${site.cookieCount} session cookie${site.cookieCount === 1 ? "" : "s"}` : "No visible cookies"}{site.credentialCount > 0 ? " · credential saved" : ""}</small></div><span>›</span></button>)}</div>}</section>
    </aside>
  );
}

function SiteDrawer({ snapshot, onDispatch, onClose }: { snapshot: AppSnapshot; onDispatch: (command: BrowserCommand) => void; onClose: () => void }) {
  const site = snapshot.sites.find((candidate) => candidate.id === snapshot.selectedSiteId);
  if (!site) return null;
  const bookmarks = snapshot.bookmarks.filter((bookmark) => bookmark.spaceId === site.spaceId && originFor(bookmark.url) === site.origin);
  return (
    <aside className="drawer site-drawer" aria-label={`${site.hostname} site dossier`}>
      <div className="drawer-header"><div><span className="eyebrow">SITE DOSSIER</span><h2>{site.hostname}</h2><p className="drawer-origin">{site.origin}</p></div><IconButton label="Close site dossier" onClick={onClose}><span>×</span></IconButton></div>
      <div className="site-hero"><span className="hero-orb" style={{ "--space-color": site.cookieCount > 0 ? "#9be7c4" : "#8190a3" } as React.CSSProperties}>◉</span><div><strong>{site.cookieCount > 0 ? "Session present" : "No session detected"}</strong><small>Last visited {new Date(site.lastVisitedAt).toLocaleDateString()}</small></div></div>
      <div className="site-stats"><div><strong>{site.cookieCount}</strong><small>cookies</small></div><div><strong>{site.storagePresent ? "On" : "Off"}</strong><small>site data</small></div><div><strong>{site.credentialCount}</strong><small>logins</small></div></div>
      <section className="drawer-section"><div className="section-heading"><span>Controls</span></div><div className="control-stack"><button type="button" onClick={() => onDispatch({ type: "site.clearData", siteId: site.id })}><span>⌫</span><div><strong>Clear site data</strong><small>Cookies, cache, storage, and service workers</small></div><span>›</span></button><button type="button" onClick={() => onDispatch({ type: "site.forget", siteId: site.id, clearData: false, removeCredentials: true })}><span>◌</span><div><strong>Remove saved logins</strong><small>Keep website data, remove Vault credentials</small></div><span>›</span></button><button type="button" onClick={() => onDispatch({ type: "site.forget", siteId: site.id, clearData: true, removeCredentials: true })}><span className="danger-glyph">!</span><div><strong>Forget this site</strong><small>Clear data, logins, bookmarks, and site memory</small></div><span>›</span></button></div></section>
      <section className="drawer-section"><div className="section-heading"><span>Saved here</span></div><div className="site-memory"><span>✦</span><p>{bookmarks.length > 0 ? "Bookmarked in this Space." : "Not bookmarked in this Space."}</p></div></section>
    </aside>
  );
}

function PromptCard({ request, spaceName, onDispatch }: { request: CredentialSaveRequest; spaceName: string; onDispatch: (command: BrowserCommand) => void }) {
  return (
    <div className="credential-prompt"><div className="prompt-icon">◒</div><div className="prompt-copy"><span className="eyebrow">NEW LOGIN DETECTED</span><strong>Save {request.hostname}?</strong><small>{request.username || "A new credential"} · {spaceName}</small></div><button type="button" onClick={() => onDispatch({ type: "credential.save", requestId: request.requestId })}>Save</button><button className="prompt-never" type="button" onClick={() => onDispatch({ type: "credential.reject", requestId: request.requestId, neverForSite: true })}>Never</button><button className="prompt-dismiss" type="button" onClick={() => onDispatch({ type: "credential.reject", requestId: request.requestId })}>×</button></div>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot);
  const [maximized, setMaximized] = useState(false);
  const [drawer, setDrawer] = useState<"vault" | "site" | null>(null);
  const [credentialPrompt, setCredentialPrompt] = useState<Extract<BrowserEvent, { type: "credential-save-request" }> ["request"] | null>(null);
  const [toast, setToast] = useState<{ tone: "info" | "success" | "error"; message: string } | null>(null);
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
      if (event.type === "credential-save-request") setCredentialPrompt(event.request);
      if (event.type === "toast") {
        setToast({ tone: event.tone, message: event.message });
        window.setTimeout(() => setToast(null), 3600);
      }
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
      window.browserAPI.setBrowserViewport({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    };
    const observer = new ResizeObserver(updateBounds);
    observer.observe(element);
    updateBounds();
    return () => observer.disconnect();
  }, [drawer]);

  const dispatch = (command: BrowserCommand): void => {
    if (command.type === "credential.save" || command.type === "credential.reject") setCredentialPrompt(null);
    void window.browserAPI?.dispatch(command).then((result) => {
      if (!result.ok) setToast({ tone: "error", message: result.error });
      else setSnapshot(result.snapshot);
    });
  };

  const activeTab = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
  const activeSpace = snapshot.spaces.find((space) => space.id === snapshot.activeSpaceId);
  const visibleTabs = useMemo(() => snapshot.scope === "all" ? snapshot.tabs : snapshot.tabs.filter((tab) => tab.spaceId === snapshot.scope), [snapshot.tabs, snapshot.scope]);
  const promptSpace = snapshot.spaces.find((space) => space.id === credentialPrompt?.spaceId);

  const selectScope = (scope: SpaceScope): void => {
    setSpaceMenuId(null);
    dispatch({ type: "space.select", scope });
  };

  const openSite = (): void => {
    if (!activeTab) return;
    const origin = originFor(activeTab.url);
    const site = snapshot.sites.find((candidate) => candidate.spaceId === activeTab.spaceId && candidate.origin === origin);
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
    if (window.confirm(`Delete ${space.name}? Its tabs, bookmarks, site memory, and session will be removed.`)) dispatch({ type: "space.delete", spaceId: space.id });
    setSpaceMenuId(null);
  };

  return (
    <main className="app-shell" onClick={() => spaceMenuId && setSpaceMenuId(null)}>
      <header className="titlebar">
        <div className="brand" aria-label="AI Browser"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span><span className="brand-name">AI Browser</span><span className="brand-separator">/</span><span className="brand-context">local browser</span></div>
        <div className="titlebar-status"><span className="status-dot" /> encrypted locally</div>
        <div className="window-controls"><WindowButton label="Minimize window" onClick={() => window.windowControls?.minimize()}><span className="minimize-icon" /></WindowButton><WindowButton label={maximized ? "Restore window" : "Maximize window"} onClick={() => { window.windowControls?.toggleMaximize(); setMaximized((current) => !current); }}><span className={maximized ? "restore-icon" : "maximize-icon"} /></WindowButton><WindowButton label="Close window" onClick={() => window.windowControls?.close()} danger><span className="close-icon" /></WindowButton></div>
      </header>

      <div className="canvas">
        <SpaceRail snapshot={snapshot} onScope={selectScope} onCreate={() => setSpaceDialogOpen(true)} onPrivate={() => dispatch({ type: "space.createPrivate" })} onSpaceMenu={(spaceId) => { setSpaceMenuId(spaceId); }} menuSpaceId={spaceMenuId} onRename={renameSpace} onDelete={deleteSpace} />
        <CommandDock snapshot={{ ...snapshot, drawer }} activeTab={activeTab} activeSpace={activeSpace} onDispatch={dispatch} onOpenVault={() => { setDrawer(drawer === "vault" ? null : "vault"); }} onOpenSite={openSite} />
        <TabDeck tabs={visibleTabs} spaces={snapshot.spaces} activeTabId={snapshot.activeTabId} onActivate={(tabId) => tabId ? dispatch({ type: "tab.activate", tabId }) : dispatch({ type: "tab.create" })} onClose={(tabId) => dispatch({ type: "tab.close", tabId })} onHibernate={(tabId) => dispatch({ type: "tab.hibernate", tabId })} onMoveTab={(tabId, spaceId, clone) => dispatch(clone ? { type: "tab.cloneToSpace", tabId, spaceId } : { type: "tab.moveToSpace", tabId, spaceId })} />
        <div ref={viewportRef} className={`browser-viewport${drawer ? " has-drawer" : ""}`} aria-label="Browser surface"><div className="viewport-fallback"><span className="fallback-orb">✦</span><strong>Choose a surface</strong><small>Open a tab or select a Space to begin.</small></div></div>
        {drawer === "vault" && <VaultDrawer snapshot={snapshot} onDispatch={(command) => { if (command.type === "site.inspect") openSiteFromVault(command.siteId); else dispatch(command); }} onClose={() => setDrawer(null)} />}
        {drawer === "site" && <SiteDrawer snapshot={{ ...snapshot, drawer: "site" }} onDispatch={dispatch} onClose={() => setDrawer(null)} />}
        {credentialPrompt && promptSpace && <PromptCard request={credentialPrompt} spaceName={promptSpace.name} onDispatch={dispatch} />}
        {toast && <div className={`toast toast-${toast.tone}`} role="status"><span>{toast.tone === "error" ? "!" : "✓"}</span>{toast.message}</div>}
      </div>

      {spaceDialogOpen && <div className="modal-scrim" role="presentation"><form className="space-dialog" onSubmit={createSpace}><span className="eyebrow">NEW CONTEXT</span><h2>Give this Space a name.</h2><p>A new isolated session will be created for it.</p><input autoFocus value={spaceName} onChange={(event) => setSpaceName(event.target.value)} placeholder="e.g. Research, Studio, Finance" aria-label="Space name" /><div className="dialog-actions"><button type="button" onClick={() => setSpaceDialogOpen(false)}>Cancel</button><button className="primary-button" type="submit">Create Space <span>↗</span></button></div></form></div>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
