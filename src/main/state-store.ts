import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AppSnapshot,
  Bookmark,
  PersistedState,
  SiteRecord,
  Space,
  SpaceScope,
  Tab,
} from "../shared/contracts";

const GOOGLE_URL = "https://www.google.com";
const DEFAULT_COLORS = ["#9be7c4", "#8db4ff", "#f4bf7a", "#d8a5ff", "#ff9d9d"];

const now = (): string => new Date().toISOString();

const starterSpace = (id: string, name: string, color: string): Space => ({
  id,
  name,
  color,
  icon: name === "Work" ? "briefcase" : "home",
  kind: "persistent",
  createdAt: now(),
  updatedAt: now(),
});

const createDefaultState = (): PersistedState => {
  const personal = starterSpace("personal", "Personal", DEFAULT_COLORS[0]);
  const work = starterSpace("work", "Work", DEFAULT_COLORS[1]);
  const firstTab: Tab = {
    id: randomUUID(),
    spaceId: personal.id,
    title: "Google",
    url: GOOGLE_URL,
    status: "loading",
    createdAt: now(),
    lastActiveAt: now(),
  };

  return {
    version: 1,
    spaces: [personal, work],
    tabs: [firstTab],
    bookmarks: [],
    sites: [],
    scope: personal.id,
    activeSpaceId: personal.id,
    activeTabId: firstTab.id,
    drawer: null,
    selectedSiteId: null,
  };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isValidState = (value: unknown): value is PersistedState => {
  if (!isObject(value)) return false;
  return value.version === 1 && Array.isArray(value.spaces) && Array.isArray(value.tabs);
};

export class AppStateStore {
  private state: PersistedState = createDefaultState();
  private writeTimer: NodeJS.Timeout | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (isValidState(parsed)) {
        this.state = {
          ...createDefaultState(),
          ...parsed,
          drawer: parsed.drawer ?? null,
          selectedSiteId: parsed.selectedSiteId ?? null,
        };
      }
    } catch (error: unknown) {
      const code = isObject(error) && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        console.error("[state] unable to read app state; using a fresh state", error);
      }
    }
  }

  getState(): PersistedState {
    return structuredClone(this.state);
  }

  update(mutator: (state: PersistedState) => void): PersistedState {
    mutator(this.state);
    this.scheduleWrite();
    return this.getState();
  }

  addSpace(input: { name: string; color?: string; icon?: string; kind?: "persistent" | "private" }): Space {
    const timestamp = now();
    const space: Space = {
      id: `${input.kind === "private" ? "private" : "space"}-${randomUUID()}`,
      name: input.name.trim() || "New Space",
      color: input.color ?? DEFAULT_COLORS[this.state.spaces.length % DEFAULT_COLORS.length],
      icon: input.icon ?? "sparkles",
      kind: input.kind ?? "persistent",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.state.spaces.push(space);
    this.scheduleWrite();
    return structuredClone(space);
  }

  removeSpace(spaceId: string): boolean {
    const space = this.state.spaces.find((candidate) => candidate.id === spaceId);
    if (!space) return false;
    const persistentSpaces = this.state.spaces.filter((candidate) => candidate.kind === "persistent");
    if (space.kind === "persistent" && persistentSpaces.length <= 1) return false;

    this.state.spaces = this.state.spaces.filter((candidate) => candidate.id !== spaceId);
    this.state.tabs = this.state.tabs.filter((tab) => tab.spaceId !== spaceId);
    this.state.bookmarks = this.state.bookmarks.filter((bookmark) => bookmark.spaceId !== spaceId);
    this.state.sites = this.state.sites.filter((site) => site.spaceId !== spaceId);

    if (this.state.activeSpaceId === spaceId) {
      const next = this.state.spaces.find((candidate) => candidate.kind === "persistent");
      if (next) {
        this.state.activeSpaceId = next.id;
        this.state.scope = next.id;
        this.state.activeTabId = this.state.tabs.find((tab) => tab.spaceId === next.id)?.id ?? null;
      }
    }

    this.scheduleWrite();
    return true;
  }

  addTab(tab: Tab): void {
    this.state.tabs.push(tab);
    this.state.activeTabId = tab.id;
    this.state.activeSpaceId = tab.spaceId;
    this.state.scope = tab.spaceId;
    this.scheduleWrite();
  }

  removeTab(tabId: string): void {
    this.state.tabs = this.state.tabs.filter((tab) => tab.id !== tabId);
    if (this.state.activeTabId === tabId) {
      const next = this.visibleTabs(this.state.scope)[0] ?? this.state.tabs[0];
      this.state.activeTabId = next?.id ?? null;
      if (next) this.state.activeSpaceId = next.spaceId;
    }
    this.scheduleWrite();
  }

  updateTab(tabId: string, update: Partial<Tab>): void {
    const tab = this.state.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    Object.assign(tab, update);
    this.scheduleWrite();
  }

  selectScope(scope: SpaceScope): void {
    this.state.scope = scope;
    if (scope !== "all") {
      this.state.activeSpaceId = scope;
      const current = this.state.tabs.find((tab) => tab.id === this.state.activeTabId);
      if (!current || current.spaceId !== scope) {
        this.state.activeTabId = this.state.tabs.find((tab) => tab.spaceId === scope)?.id ?? null;
      }
    }
    this.scheduleWrite();
  }

  activateTab(tabId: string): void {
    const tab = this.state.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    tab.lastActiveAt = now();
    this.state.activeTabId = tab.id;
    this.state.activeSpaceId = tab.spaceId;
    this.state.scope = tab.spaceId;
    this.scheduleWrite();
  }

  setDrawer(drawer: PersistedState["drawer"], selectedSiteId: string | null = null): void {
    this.state.drawer = drawer;
    this.state.selectedSiteId = selectedSiteId;
    this.scheduleWrite();
  }

  upsertSite(site: SiteRecord): void {
    const existing = this.state.sites.findIndex((candidate) => candidate.id === site.id);
    if (existing === -1) this.state.sites.push(site);
    else this.state.sites[existing] = site;
    this.scheduleWrite();
  }

  removeSite(siteId: string): void {
    this.state.sites = this.state.sites.filter((site) => site.id !== siteId);
    if (this.state.selectedSiteId === siteId) {
      this.state.selectedSiteId = null;
      this.state.drawer = null;
    }
    this.scheduleWrite();
  }

  upsertBookmark(bookmark: Bookmark): void {
    const existing = this.state.bookmarks.findIndex((candidate) => candidate.id === bookmark.id);
    if (existing === -1) this.state.bookmarks.push(bookmark);
    else this.state.bookmarks[existing] = bookmark;
    const site = this.state.sites.find((candidate) => candidate.id === bookmark.id);
    if (site) site.bookmarked = true;
    this.scheduleWrite();
  }

  removeBookmark(bookmarkId: string): void {
    this.state.bookmarks = this.state.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId);
    const site = this.state.sites.find((candidate) => candidate.id === bookmarkId);
    if (site) site.bookmarked = false;
    this.scheduleWrite();
  }

  visibleTabs(scope: SpaceScope): Tab[] {
    return this.state.tabs.filter((tab) => scope === "all" || tab.spaceId === scope);
  }

  snapshot(credentials: import("../shared/contracts").CredentialSummary[], vaultAvailable: boolean): AppSnapshot {
    return {
      ...this.getState(),
      credentials: structuredClone(credentials),
      vaultAvailable,
    };
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    await this.writeNow();
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void this.writeNow();
    }, 150);
  }

  private async writeNow(): Promise<void> {
    const state = this.getState();
    const persistable: PersistedState = {
      ...state,
      spaces: state.spaces.filter((space) => space.kind === "persistent"),
      tabs: state.tabs.filter((tab) => state.spaces.some((space) => space.id === tab.spaceId && space.kind === "persistent")),
      bookmarks: state.bookmarks.filter((bookmark) => state.spaces.some((space) => space.id === bookmark.spaceId && space.kind === "persistent")),
      sites: state.sites.filter((site) => state.spaces.some((space) => space.id === site.spaceId && space.kind === "persistent")),
    };
    const temporaryPath = `${this.filePath}.tmp`;
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(temporaryPath, JSON.stringify(persistable, null, 2), "utf8");
      await rename(temporaryPath, this.filePath);
    }).catch((error: unknown) => {
      console.error("[state] unable to persist app state", error);
    });
    await this.writeChain;
  }
}
