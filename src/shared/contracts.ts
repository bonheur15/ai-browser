export type SpaceKind = "persistent" | "private";
export type SpaceScope = "all" | string;
export type TabStatus = "loading" | "loaded" | "hibernated";
export type DrawerKind = "vault" | "site" | null;

export type AppearanceMode = "dark" | "light" | "system";
export type AccentId = "mint" | "blue" | "violet" | "amber" | "rose" | "cyan";

export type AppearanceSettings = {
  mode: AppearanceMode;
  accent: AccentId;
};

export type AppSettings = {
  appearance: AppearanceSettings;
};

export type Space = {
  id: string;
  name: string;
  color: string;
  icon: string;
  kind: SpaceKind;
  createdAt: string;
  updatedAt: string;
};

export type Tab = {
  id: string;
  spaceId: string;
  title: string;
  url: string;
  faviconUrl?: string;
  status: TabStatus;
  createdAt: string;
  lastActiveAt: string;
  /** Ephemeral runtime marker; never persisted. */
  agentLock?: { threadId: string };
};

export type Bookmark = {
  id: string;
  spaceId: string;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
};

export type SiteRecord = {
  id: string;
  spaceId: string;
  origin: string;
  hostname: string;
  lastVisitedAt: string;
  credentialCount: number;
  bookmarked: boolean;
  cookieCount: number;
  storagePresent: boolean;
  neverSaveCredentials: boolean;
};

export type CredentialSummary = {
  id: string;
  spaceId: string;
  origin: string;
  hostname: string;
  username: string;
  createdAt: string;
  updatedAt: string;
};

export type CredentialSaveRequest = {
  requestId: string;
  tabId: string;
  spaceId: string;
  origin: string;
  hostname: string;
  username: string;
};

export type AppSnapshot = {
  spaces: Space[];
  tabs: Tab[];
  bookmarks: Bookmark[];
  sites: SiteRecord[];
  credentials: CredentialSummary[];
  scope: SpaceScope;
  activeSpaceId: string;
  activeTabId: string | null;
  drawer: DrawerKind;
  selectedSiteId: string | null;
  vaultAvailable: boolean;
  settings: AppSettings;
};

export type BrowserViewportBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserSecurityStatus = "secure" | "not-secure" | "special";

export type BrowserRuntimeStatus = {
  activeTabId: string | null;
  memoryUsageMb: number | null;
  security: BrowserSecurityStatus;
  securityMessage: string;
  loading: boolean;
  sampledAt: string;
};

export type BrowserCommand =
  | { type: "space.create"; name?: string; color?: string; icon?: string }
  | { type: "space.rename"; spaceId: string; name: string }
  | { type: "space.updateAppearance"; spaceId: string; color: string; icon: string }
  | { type: "space.delete"; spaceId: string }
  | { type: "space.select"; scope: SpaceScope }
  | { type: "space.createPrivate" }
  | { type: "tab.create"; spaceId?: string; url?: string }
  | { type: "tab.activate"; tabId: string }
  | { type: "tab.close"; tabId: string }
  | { type: "tab.cloneToSpace"; tabId: string; spaceId: string }
  | { type: "tab.moveToSpace"; tabId: string; spaceId: string }
  | { type: "tab.hibernate"; tabId: string }
  | { type: "tab.restore"; tabId: string }
  | { type: "navigation.back"; tabId?: string }
  | { type: "navigation.forward"; tabId?: string }
  | { type: "navigation.reload"; tabId?: string }
  | { type: "navigation.search"; tabId?: string; input: string }
  | { type: "bookmark.create"; tabId?: string }
  | { type: "bookmark.remove"; bookmarkId: string }
  | { type: "site.inspect"; siteId: string }
  | { type: "site.clearData"; siteId: string }
  | { type: "site.forget"; siteId: string; clearData: boolean; removeCredentials: boolean }
  | { type: "credential.save"; requestId: string }
  | { type: "credential.reject"; requestId: string; neverForSite?: boolean }
  | { type: "credential.fill"; credentialId: string; tabId?: string }
  | { type: "credential.remove"; credentialId: string }
  | { type: "settings.updateAppearance"; appearance: AppearanceSettings }
  | { type: "settings.resetAppearance" };

export type CommandResult =
  | { ok: true; snapshot: AppSnapshot }
  | { ok: false; error: string; snapshot: AppSnapshot };

export type BrowserEvent =
  | { type: "snapshot"; snapshot: AppSnapshot }
  | { type: "runtime-status"; status: BrowserRuntimeStatus }
  | { type: "credential-save-request"; request: CredentialSaveRequest }
  | { type: "toast"; tone: "info" | "success" | "error"; message: string };

export type BrowserAPI = {
  getSnapshot: () => Promise<AppSnapshot>;
  dispatch: (command: BrowserCommand) => Promise<CommandResult>;
  subscribe: (listener: (event: BrowserEvent) => void) => () => void;
  setBrowserViewport: (bounds: BrowserViewportBounds) => void;
  setChromeOverlayActive: (active: boolean) => void;
};

export type StoredCredential = CredentialSummary & {
  password: string;
};

export type PersistedState = {
  version: 2;
  spaces: Space[];
  tabs: Tab[];
  bookmarks: Bookmark[];
  sites: SiteRecord[];
  scope: SpaceScope;
  activeSpaceId: string;
  activeTabId: string | null;
  drawer: DrawerKind;
  selectedSiteId: string | null;
  settings: AppSettings;
};
