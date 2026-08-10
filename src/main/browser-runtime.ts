import { randomUUID } from "node:crypto";
import path from "node:path";
import { app, type BaseWindow, shell, type WebContents, WebContentsView } from "electron";
import type {
  BrowserPageContext,
  BrowserPageRequest,
  BrowserPageRequestInput,
  BrowserPageResponse,
} from "../shared/agent-contracts";
import type {
  AppSnapshot,
  BrowserCommand,
  BrowserEvent,
  BrowserRuntimeStatus,
  BrowserSecurityStatus,
  BrowserViewportBounds,
  CommandResult,
  CredentialSaveRequest,
  CredentialSummary,
  SiteRecord,
  Space,
  StoredCredential,
  Tab,
} from "../shared/contracts";
import { AgentTabLocks } from "./agent-tab-locks";
import {
  DEFAULT_URL,
  hostnameFor,
  NEW_TAB_URL,
  navigationUrl,
  originFor,
} from "./browser-navigation";
import type { SecretVault } from "./secret-vault";
import type { SpaceSessionManager } from "./space-session-manager";
import type { AppStateStore } from "./state-store";

type LoginCandidate = {
  origin: string;
  hostname: string;
  username: string;
  password: string;
};

type PendingCandidate = LoginCandidate & {
  request: CredentialSaveRequest;
  timeout: NodeJS.Timeout;
};

type ScreenshotContext = {
  snapshotId: string;
  scaleX: number;
  scaleY: number;
};

export const classifyBrowserSecurity = (
  url: string,
  certificateError = false,
): { security: BrowserSecurityStatus; securityMessage: string } => {
  if (certificateError)
    return {
      security: "not-secure",
      securityMessage: "The page certificate could not be verified",
    };
  try {
    const protocol = new URL(url).protocol;
    if (protocol === "https:")
      return { security: "secure", securityMessage: "Encrypted HTTPS connection" };
    if (protocol === "http:")
      return {
        security: "not-secure",
        securityMessage: "This page is using an unencrypted HTTP connection",
      };
  } catch {
    // Invalid and renderer-generated URLs are special browser pages.
  }
  return { security: "special", securityMessage: "This is a browser-generated or special page" };
};

export const aggregateMemoryUsageMb = (
  metrics: Array<{ memory?: { workingSetSize?: number } }>,
): number | null => {
  const values = metrics
    .map((metric) => metric.memory?.workingSetSize)
    .filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0,
    );
  if (values.length === 0) return null;
  return Math.round((values.reduce((total, value) => total + value, 0) / 1024) * 10) / 10;
};

export class BrowserRuntime {
  private readonly views = new Map<string, WebContentsView>();
  private readonly pendingCandidates = new Map<string, PendingCandidate>();
  private readonly pendingPageRequests = new Map<
    string,
    {
      senderId: number;
      resolve: (response: BrowserPageResponse) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private readonly screenshotContexts = new Map<string, ScreenshotContext>();
  private readonly pendingFillResults = new Map<
    string,
    { senderId: number; resolve: (ok: boolean) => void; timer: NodeJS.Timeout }
  >();
  private readonly agentLocks: AgentTabLocks;
  private readonly certificateErrors = new Set<string>();
  private attachedTabId: string | null = null;
  private viewport: BrowserViewportBounds = { x: 92, y: 154, width: 1120, height: 600 };
  private runtimeStatusTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly window: BaseWindow,
    private readonly state: AppStateStore,
    private readonly sessions: SpaceSessionManager,
    private readonly vault: SecretVault,
    private readonly emit: (event: BrowserEvent) => void,
  ) {
    this.agentLocks = new AgentTabLocks((tabId, locked) => {
      void this.setViewInteractionLocked(tabId, locked);
    });
  }

  async initialize(): Promise<void> {
    const snapshot = this.state.getState();
    for (const tab of snapshot.tabs) {
      const space = this.getSpace(tab.spaceId);
      if (space) this.createView(tab, space);
    }

    if (!snapshot.activeTabId && snapshot.spaces[0]) {
      await this.createTab(snapshot.spaces[0].id, DEFAULT_URL);
    } else if (snapshot.activeTabId) {
      this.attachTab(snapshot.activeTabId);
    }
    this.publish();
    this.publishRuntimeStatus();
    this.runtimeStatusTimer = setInterval(() => this.publishRuntimeStatus(), 2_000);
  }

  dispose(): void {
    if (this.runtimeStatusTimer) clearInterval(this.runtimeStatusTimer);
    this.runtimeStatusTimer = null;
    for (const view of this.views.values()) {
      this.window.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
    }
    this.views.clear();
    this.attachedTabId = null;
  }

  private currentRuntimeStatus(): BrowserRuntimeStatus {
    const snapshot = this.state.getState();
    const tab = snapshot.tabs.find((candidate) => candidate.id === this.attachedTabId);
    const security = classifyBrowserSecurity(
      tab?.url ?? "about:blank",
      tab ? this.certificateErrors.has(tab.id) : false,
    );
    let memoryUsageMb: number | null = null;
    try {
      memoryUsageMb = aggregateMemoryUsageMb(app.getAppMetrics());
    } catch {
      memoryUsageMb = null;
    }
    return {
      activeTabId: tab?.id ?? null,
      memoryUsageMb,
      ...security,
      loading: tab?.status === "loading",
      sampledAt: new Date().toISOString(),
    };
  }

  private publishRuntimeStatus(): void {
    this.emit({ type: "runtime-status", status: this.currentRuntimeStatus() });
  }

  snapshot(): AppSnapshot {
    const snapshot = this.state.snapshot(this.vault.summaries(), this.vault.available);
    return {
      ...snapshot,
      tabs: snapshot.tabs.map((tab) => {
        const lock = this.agentLocks.get(tab.id);
        return lock ? { ...tab, agentLock: lock } : tab;
      }),
    };
  }

  setAgentTabLock(tabId: string, threadId: string, locked: boolean): void {
    if (locked) {
      this.agentLocks.set(tabId, threadId, true);
    } else {
      this.agentLocks.set(tabId, threadId, false);
    }
    this.publish();
  }

  private async setViewInteractionLocked(tabId: string, locked: boolean): Promise<void> {
    const view = this.views.get(tabId);
    if (!view || view.webContents.isDestroyed()) return;
    const value = locked ? "none" : "auto";
    try {
      await view.webContents.executeJavaScript(
        `document.documentElement.style.pointerEvents = ${JSON.stringify(value)}; document.body && (document.body.style.pointerEvents = ${JSON.stringify(value)});`,
        true,
      );
    } catch {
      // A page can be between navigations; the next load event reapplies the lock.
    }
  }

  releaseAgentTabLocks(threadId: string): void {
    this.agentLocks.release(threadId);
  }

  setViewport(bounds: BrowserViewportBounds): void {
    this.viewport = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    };
    this.resizeAttachedView();
  }

  getAgentTab(tabId: string): Tab {
    return this.requireTab(tabId);
  }

  getAgentSpace(spaceId: string): Space {
    return this.requireSpace(spaceId);
  }

  listAgentCredentials(spaceId: string, origin?: string): CredentialSummary[] {
    return this.vault
      .summaries(spaceId)
      .filter((credential) => !origin || credential.origin === origin);
  }

  async agentCreateTab(spaceId: string, url = DEFAULT_URL): Promise<Tab> {
    return this.createTab(spaceId, url === DEFAULT_URL ? DEFAULT_URL : navigationUrl(url));
  }

  async agentCloseTab(tabId: string): Promise<void> {
    await this.closeTab(tabId);
  }

  async agentActivateTab(tabId: string): Promise<void> {
    await this.activateTab(tabId);
  }

  async agentCloneTab(tabId: string, spaceId: string): Promise<Tab> {
    return this.cloneTab(tabId, spaceId, false);
  }

  async agentMoveTab(tabId: string, spaceId: string): Promise<Tab> {
    return this.cloneTab(tabId, spaceId, true);
  }

  async agentNavigate(tabId: string, input: string): Promise<void> {
    await this.activateTab(tabId);
    await this.loadTabURL(this.requireView(tabId), navigationUrl(input));
  }

  async agentBack(tabId: string): Promise<void> {
    await this.activateTab(tabId);
    this.requireView(tabId).webContents.goBack();
  }

  async agentForward(tabId: string): Promise<void> {
    await this.activateTab(tabId);
    this.requireView(tabId).webContents.goForward();
  }

  async agentReload(tabId: string): Promise<void> {
    await this.activateTab(tabId);
    this.requireView(tabId).webContents.reload();
  }

  async agentPageRequest(
    tabId: string,
    request: BrowserPageRequestInput,
  ): Promise<BrowserPageResponse> {
    await this.activateTab(tabId);
    const view = this.requireView(tabId);
    const requestId = randomUUID();
    if (
      request.type === "click" &&
      !request.ref &&
      typeof request.x === "number" &&
      typeof request.y === "number"
    ) {
      const screenshotContext = this.screenshotContexts.get(tabId);
      if (screenshotContext?.snapshotId !== request.snapshotId) {
        return {
          requestId,
          ok: false,
          error: "Coordinate clicks require a recent screenshot context",
        };
      }
      this.screenshotContexts.delete(tabId);
      const x = Math.round(request.x * screenshotContext.scaleX);
      const y = Math.round(request.y * screenshotContext.scaleY);
      view.webContents.focus();
      view.webContents.sendInputEvent({ type: "mouseMove", x, y });
      view.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
      view.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
      return {
        requestId,
        ok: true,
        result: {
          coordinate: { x: request.x, y: request.y },
          nativeCoordinate: { x, y },
          input: "native-mouse",
        },
      };
    }
    const pageRequest = { ...request, requestId } as BrowserPageRequest;
    return new Promise<BrowserPageResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPageRequests.delete(requestId);
        reject(new Error("The page did not respond in time"));
      }, 20_000);
      this.pendingPageRequests.set(requestId, {
        senderId: view.webContents.id,
        resolve,
        reject,
        timer,
      });
      view.webContents.send("browser:agent-page-request", pageRequest);
    });
  }

  async agentPageContext(tabId: string): Promise<BrowserPageContext> {
    const response = await this.agentPageRequest(tabId, { type: "context" });
    if (!response.ok || !response.context)
      throw new Error(response.error ?? "Unable to read the page context");
    const screenshotContext = this.screenshotContexts.get(tabId);
    if (screenshotContext)
      this.screenshotContexts.set(tabId, {
        ...screenshotContext,
        snapshotId: response.context.snapshotId,
      });
    return response.context;
  }

  async agentCaptureScreenshot(
    tabId: string,
  ): Promise<{ dataUrl: string; url: string; title: string }> {
    const context = await this.agentPageContext(tabId);
    try {
      const redaction = await this.agentPageRequest(tabId, {
        type: "redact",
        snapshotId: context.snapshotId,
        enabled: true,
      });
      if (!redaction.ok)
        throw new Error(
          redaction.error ?? "Unable to redact sensitive fields before taking a screenshot",
        );
      const image = await this.requireView(tabId).webContents.capturePage();
      const size = image.getSize();
      const resized = size.width > 1280 ? image.resize({ width: 1280 }) : image;
      const outputSize = resized.getSize();
      this.screenshotContexts.set(tabId, {
        snapshotId: context.snapshotId,
        scaleX: size.width / outputSize.width,
        scaleY: size.height / outputSize.height,
      });
      return { dataUrl: resized.toDataURL(), url: context.url, title: context.title };
    } finally {
      try {
        await this.agentPageRequest(tabId, {
          type: "redact",
          snapshotId: context.snapshotId,
          enabled: false,
        });
      } catch {
        // The page may have navigated while the screenshot was being captured.
      }
    }
  }

  async agentFillCredential(credentialId: string, tabId: string): Promise<boolean> {
    const tab = this.requireTab(tabId);
    const credential = this.vault.get(credentialId, tab.spaceId);
    if (!credential) throw new Error("Credential is not available in this Space");
    if (originFor(tab.url) !== credential.origin)
      throw new Error("Credential origin does not match the active page");
    await this.activateTab(tab.id);
    return this.fillCredential(credentialId, tab.id);
  }

  handleAgentPageResponse(sender: WebContents, response: unknown): void {
    if (!isBrowserPageResponse(response)) return;
    const pending = this.pendingPageRequests.get(response.requestId);
    if (!pending || pending.senderId !== sender.id) return;
    clearTimeout(pending.timer);
    this.pendingPageRequests.delete(response.requestId);
    pending.resolve(response);
  }

  async dispatch(command: BrowserCommand): Promise<CommandResult> {
    try {
      await this.execute(command);
      this.publish();
      return { ok: true, snapshot: this.snapshot() };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "The browser action failed";
      this.emit({ type: "toast", tone: "error", message });
      return { ok: false, error: message, snapshot: this.snapshot() };
    }
  }

  handleLoginCandidate(sender: WebContents, candidate: unknown): void {
    if (!isLoginCandidate(candidate)) return;
    const tab = this.findTabByWebContents(sender);
    if (!tab) return;
    const senderOrigin = originFor(sender.getURL());
    if (!senderOrigin || candidate.origin !== senderOrigin) return;
    const space = this.getSpace(tab.spaceId);
    if (!space || space.kind === "private") return;
    if (!this.vault.available) {
      this.emit({
        type: "toast",
        tone: "error",
        message: "Password saving is unavailable because secure OS storage is not available",
      });
      return;
    }
    const site = this.findSite(space.id, candidate.origin);
    if (site?.neverSaveCredentials) return;

    const request: CredentialSaveRequest = {
      requestId: randomUUID(),
      tabId: tab.id,
      spaceId: space.id,
      origin: candidate.origin,
      hostname: candidate.hostname,
      username: candidate.username,
    };
    const timeout = setTimeout(() => {
      this.pendingCandidates.delete(request.requestId);
    }, 15_000);
    this.pendingCandidates.set(request.requestId, { ...candidate, request, timeout });
    this.emit({ type: "credential-save-request", request });
  }

  handleCredentialFillResult(sender: WebContents, result: unknown): void {
    if (!isObject(result) || typeof result.requestId !== "string") return;
    const pending = this.pendingFillResults.get(result.requestId);
    if (pending && pending.senderId === sender.id) {
      clearTimeout(pending.timer);
      this.pendingFillResults.delete(result.requestId);
      pending.resolve(result.ok === true);
    }
    this.emit({
      type: "toast",
      tone: result.ok === true ? "success" : "error",
      message: result.ok === true ? "Credential filled" : "No compatible login form found",
    });
  }

  async flush(): Promise<void> {
    await Promise.all([this.state.flush(), this.vault.flush(), this.sessions.flush()]);
  }

  private async execute(command: BrowserCommand): Promise<void> {
    const targetTabId =
      "tabId" in command && typeof command.tabId === "string" ? command.tabId : undefined;
    if (targetTabId && this.agentLocks.has(targetTabId))
      throw new Error("This tab is currently being used by the agent");
    switch (command.type) {
      case "space.create": {
        const space = this.state.addSpace({
          name: command.name ?? "New Space",
          ...(command.color ? { color: command.color } : {}),
          ...(command.icon ? { icon: command.icon } : {}),
        });
        await this.createTab(space.id, DEFAULT_URL);
        return;
      }
      case "space.createPrivate": {
        const space = this.state.addSpace({
          name: "Private",
          kind: "private",
          color: "#d1b4ff",
          icon: "eye-off",
        });
        await this.createTab(space.id, DEFAULT_URL);
        return;
      }
      case "space.rename": {
        const space = this.requireSpace(command.spaceId);
        this.state.update((current) => {
          const target = current.spaces.find((candidate) => candidate.id === space.id);
          if (target) {
            target.name = command.name.trim().slice(0, 32) || target.name;
            target.updatedAt = new Date().toISOString();
          }
        });
        return;
      }
      case "space.updateAppearance": {
        this.requireSpace(command.spaceId);
        this.state.update((current) => {
          const target = current.spaces.find((candidate) => candidate.id === command.spaceId);
          if (target) {
            target.color = command.color;
            target.icon = command.icon;
            target.updatedAt = new Date().toISOString();
          }
        });
        return;
      }
      case "space.delete": {
        const space = this.requireSpace(command.spaceId);
        const tabs = this.state.getState().tabs.filter((tab) => tab.spaceId === space.id);
        for (const tab of tabs) this.destroyView(tab.id);
        if (!this.state.removeSpace(space.id))
          throw new Error("The last persistent Space cannot be deleted");
        await this.vault.removeForSpace(space.id);
        this.sessions.forget(space.id);
        this.attachTab(this.state.getState().activeTabId);
        return;
      }
      case "space.select":
        this.state.selectScope(command.scope);
        this.attachTab(this.state.getState().activeTabId);
        return;
      case "tab.create":
        await this.createTab(
          command.spaceId ?? this.state.getState().activeSpaceId,
          command.url ?? DEFAULT_URL,
        );
        return;
      case "tab.activate":
        await this.activateTab(command.tabId);
        return;
      case "tab.close":
        await this.closeTab(command.tabId);
        return;
      case "tab.cloneToSpace":
        await this.cloneTab(command.tabId, command.spaceId, false);
        return;
      case "tab.moveToSpace":
        await this.cloneTab(command.tabId, command.spaceId, true);
        return;
      case "tab.hibernate":
        this.hibernate(command.tabId);
        return;
      case "tab.restore":
        await this.restoreTab(command.tabId);
        return;
      case "navigation.back":
        this.requireView(command.tabId).webContents.goBack();
        return;
      case "navigation.forward":
        this.requireView(command.tabId).webContents.goForward();
        return;
      case "navigation.reload":
        this.requireView(command.tabId).webContents.reload();
        return;
      case "navigation.search":
        this.loadTabURL(this.requireView(command.tabId), navigationUrl(command.input));
        return;
      case "bookmark.create":
        this.createBookmark(command.tabId);
        return;
      case "bookmark.remove":
        {
          const bookmark = this.state
            .getState()
            .bookmarks.find((candidate) => candidate.id === command.bookmarkId);
          this.state.removeBookmark(command.bookmarkId);
          if (bookmark) {
            const origin = originFor(bookmark.url);
            const site = origin ? this.findSite(bookmark.spaceId, origin) : undefined;
            if (site) this.state.upsertSite({ ...site, bookmarked: false });
          }
        }
        return;
      case "site.inspect":
        await this.inspectSite(command.siteId);
        this.state.setDrawer("site", command.siteId);
        return;
      case "site.clearData":
        await this.clearSite(command.siteId);
        return;
      case "site.forget":
        await this.forgetSite(command.siteId, command.clearData, command.removeCredentials);
        return;
      case "credential.save":
        await this.saveCredential(command.requestId);
        return;
      case "credential.reject":
        this.rejectCredential(command.requestId, command.neverForSite === true);
        return;
      case "credential.fill":
        await this.fillCredential(command.credentialId, command.tabId);
        return;
      case "credential.remove":
        await this.removeCredential(command.credentialId);
        return;
    }
  }

  private createView(tab: Tab, space: Space): WebContentsView {
    const existing = this.views.get(tab.id);
    if (existing) return existing;

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: this.sessions.get(space),
        preload: path.join(__dirname, "browser-preload.js"),
      },
    });
    view.setBackgroundColor("#10151a");
    this.views.set(tab.id, view);

    view.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        void this.createTab(space.id, url);
      } else if (["mailto:", "tel:", "sms:"].some((protocol) => url.startsWith(protocol))) {
        void shell.openExternal(url).catch(() => undefined);
      }
      return { action: "deny" };
    });
    view.webContents.on("did-finish-load", () => {
      if (this.agentLocks.has(tab.id)) void this.setViewInteractionLocked(tab.id, true);
      console.log(
        `[browser] loaded ${tab.url === DEFAULT_URL ? "new tab" : view.webContents.getURL()}`,
      );
    });
    view.webContents.on("preload-error", (_event, preloadPath, error) => {
      console.error(`[browser] preload failed ${preloadPath}`, error);
    });
    view.webContents.on("console-message", (details) => {
      if (details.level === "error") {
        console.error(`[browser:${details.sourceId}:${details.lineNumber}] ${details.message}`);
      }
    });
    view.webContents.on("did-start-loading", () => this.updateTabStatus(tab.id, "loading"));
    view.webContents.on("did-stop-loading", () => this.updateTabStatus(tab.id, "loaded"));
    view.webContents.on("certificate-error", (_event, url) => {
      if (url === view.webContents.getURL() || url === tab.url) {
        this.certificateErrors.add(tab.id);
        this.publishRuntimeStatus();
      }
    });
    view.webContents.on("page-title-updated", (event, title) => {
      event.preventDefault();
      this.state.updateTab(tab.id, { title: title || hostnameFor(tab.url) });
      this.publish();
    });
    view.webContents.on("page-favicon-updated", (_event, favicons) => {
      const faviconUrl = favicons[0];
      if (faviconUrl) this.state.updateTab(tab.id, { faviconUrl });
      this.publish();
    });
    view.webContents.on("did-navigate", (_event, url) => {
      this.certificateErrors.delete(tab.id);
      void this.handleNavigation(tab.id, url);
    });
    view.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) {
        this.certificateErrors.delete(tab.id);
        void this.handleNavigation(tab.id, url);
      }
    });
    view.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (isMainFrame && errorCode !== -3) {
          this.publishRuntimeStatus();
          this.emit({
            type: "toast",
            tone: "error",
            message: `Unable to load ${hostnameFor(validatedURL)}: ${errorDescription}`,
          });
        }
      },
    );

    this.loadTabURL(view, tab.url).catch((error: unknown) => {
      console.error(`[browser] unable to load tab ${tab.id}`, error);
    });
    return view;
  }

  private async createTab(spaceId: string, url: string): Promise<Tab> {
    const space = this.requireSpace(spaceId);
    const timestamp = new Date().toISOString();
    const tab: Tab = {
      id: randomUUID(),
      spaceId: space.id,
      title: url === DEFAULT_URL ? "New tab" : hostnameFor(url),
      url,
      status: "loading",
      createdAt: timestamp,
      lastActiveAt: timestamp,
    };
    this.state.addTab(tab);
    this.createView(tab, space);
    this.attachTab(tab.id);
    return tab;
  }

  private async activateTab(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId);
    if (tab.status === "hibernated") await this.restoreTab(tab.id);
    this.state.activateTab(tab.id);
    this.attachTab(tab.id);
  }

  private async closeTab(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId);
    const state = this.state.getState();
    const spaceTabs = state.tabs.filter(
      (candidate) => candidate.spaceId === tab.spaceId && candidate.id !== tab.id,
    );
    this.destroyView(tab.id);
    this.state.removeTab(tab.id);
    if (spaceTabs.length === 0) await this.createTab(tab.spaceId, DEFAULT_URL);
    else this.attachTab(this.state.getState().activeTabId);
  }

  private async cloneTab(tabId: string, spaceId: string, closeOriginal: boolean): Promise<Tab> {
    const tab = this.requireTab(tabId);
    this.requireSpace(spaceId);
    const created = await this.createTab(spaceId, tab.url);
    if (closeOriginal) {
      this.destroyView(tab.id);
      this.state.removeTab(tab.id);
    }
    await this.activateTab(created.id);
    return created;
  }

  private hibernate(tabId: string): void {
    const tab = this.requireTab(tabId);
    if (tab.status === "hibernated") return;
    if (this.state.getState().activeTabId === tabId) {
      const replacement = this.state
        .visibleTabs(this.state.getState().scope)
        .find((candidate) => candidate.id !== tabId);
      if (!replacement) throw new Error("Open another tab before hibernating the active tab");
      this.state.activateTab(replacement.id);
      this.attachTab(replacement.id);
    }
    const view = this.views.get(tabId);
    if (view) {
      this.window.contentView.removeChildView(view);
      view.webContents.close({ waitForBeforeUnload: false });
      this.views.delete(tabId);
    }
    this.state.updateTab(tabId, { status: "hibernated" });
  }

  private async restoreTab(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId);
    if (tab.status !== "hibernated") return;
    const space = this.requireSpace(tab.spaceId);
    this.state.updateTab(tabId, { status: "loading" });
    this.createView({ ...tab, status: "loading" }, space);
    await this.activateTab(tabId);
  }

  private createBookmark(tabId?: string): void {
    const tab = this.requireTab(tabId);
    const origin = originFor(tab.url);
    if (!origin) throw new Error("Only web pages can be bookmarked");
    const existing = this.state
      .getState()
      .bookmarks.find((bookmark) => bookmark.spaceId === tab.spaceId && bookmark.url === tab.url);
    if (existing) {
      this.state.removeBookmark(existing.id);
      return;
    }
    const timestamp = new Date().toISOString();
    this.state.upsertBookmark({
      id: randomUUID(),
      spaceId: tab.spaceId,
      title: tab.title || hostnameFor(tab.url),
      url: tab.url,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const site = this.findSite(tab.spaceId, origin);
    if (site) this.state.upsertSite({ ...site, bookmarked: true });
  }

  private async inspectSite(siteId: string): Promise<void> {
    const site = this.requireSite(siteId);
    const space = this.requireSpace(site.spaceId);
    const inspected = await this.sessions.inspectOrigin(space, site.origin);
    this.state.upsertSite({ ...site, ...inspected });
  }

  private async clearSite(siteId: string): Promise<void> {
    const site = this.requireSite(siteId);
    await this.sessions.clearOrigin(this.requireSpace(site.spaceId), site.origin);
    await this.inspectSite(site.id);
    this.emit({ type: "toast", tone: "success", message: `${site.hostname} site data cleared` });
  }

  private async forgetSite(
    siteId: string,
    clearData: boolean,
    removeCredentials: boolean,
  ): Promise<void> {
    const site = this.requireSite(siteId);
    const space = this.requireSpace(site.spaceId);
    if (clearData) await this.sessions.clearOrigin(space, site.origin);
    if (removeCredentials) await this.vault.removeForOrigin(space.id, site.origin);
    const bookmarks = this.state
      .getState()
      .bookmarks.filter(
        (bookmark) => bookmark.spaceId === space.id && originFor(bookmark.url) === site.origin,
      );
    for (const bookmark of bookmarks) this.state.removeBookmark(bookmark.id);
    this.state.removeSite(site.id);
  }

  private async saveCredential(requestId: string): Promise<void> {
    const pending = this.pendingCandidates.get(requestId);
    if (!pending) throw new Error("This credential prompt has expired");
    clearTimeout(pending.timeout);
    this.pendingCandidates.delete(requestId);
    const existing = this.vault
      .summaries(pending.request.spaceId)
      .find(
        (credential) =>
          credential.origin === pending.origin && credential.username === pending.username,
      );
    const timestamp = new Date().toISOString();
    const credential: StoredCredential = {
      id: existing?.id ?? randomUUID(),
      spaceId: pending.request.spaceId,
      origin: pending.origin,
      hostname: pending.hostname,
      username: pending.username,
      password: pending.password,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await this.vault.save(credential);
    const site = this.findSite(pending.request.spaceId, pending.origin);
    if (site)
      this.state.upsertSite({
        ...site,
        credentialCount: this.vault
          .summaries(pending.request.spaceId)
          .filter((item) => item.origin === pending.origin).length,
      });
    this.emit({
      type: "toast",
      tone: "success",
      message: `Login saved in ${this.requireSpace(pending.request.spaceId).name}`,
    });
  }

  private rejectCredential(requestId: string, neverForSite: boolean): void {
    const pending = this.pendingCandidates.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingCandidates.delete(requestId);
    if (neverForSite) {
      const site = this.findSite(pending.request.spaceId, pending.origin);
      if (site) this.state.upsertSite({ ...site, neverSaveCredentials: true });
    }
  }

  private async fillCredential(credentialId: string, tabId?: string): Promise<boolean> {
    const tab = this.requireTab(tabId);
    const credential = this.vault.get(credentialId, tab.spaceId);
    if (!credential) throw new Error("Credential is not available in this Space");
    const view = this.requireView(tab.id);
    const requestId = randomUUID();
    const result = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingFillResults.delete(requestId);
        resolve(false);
      }, 10_000);
      this.pendingFillResults.set(requestId, { senderId: view.webContents.id, resolve, timer });
    });
    view.webContents.send("browser:fill-credential", {
      requestId,
      username: credential.username,
      password: credential.password,
    });
    return result;
  }

  private async removeCredential(credentialId: string): Promise<void> {
    const credential = this.vault.get(credentialId);
    if (!credential) return;
    await this.vault.remove(credentialId, credential.spaceId);
    const site = this.findSite(credential.spaceId, credential.origin);
    if (site)
      this.state.upsertSite({
        ...site,
        credentialCount: this.vault
          .summaries(credential.spaceId)
          .filter((item) => item.origin === credential.origin).length,
      });
  }

  private async handleNavigation(tabId: string, url: string): Promise<void> {
    const tab = this.requireTab(tabId);
    if (url === NEW_TAB_URL) {
      this.state.updateTab(tabId, {
        url: DEFAULT_URL,
        title: "New tab",
        status: "loaded",
        lastActiveAt: new Date().toISOString(),
      });
      this.publish();
      this.publishRuntimeStatus();
      return;
    }
    const origin = originFor(url);
    this.state.updateTab(tabId, {
      url,
      title: hostnameFor(url),
      status: "loaded",
      lastActiveAt: new Date().toISOString(),
    });
    if (origin && tab.spaceId) {
      const current = this.findSite(tab.spaceId, origin);
      const inspected = await this.sessions.inspectOrigin(this.requireSpace(tab.spaceId), origin);
      this.state.upsertSite(
        current
          ? { ...current, ...inspected, lastVisitedAt: new Date().toISOString() }
          : this.newSite(tab.spaceId, origin, inspected),
      );
    }
    this.publish();
    this.publishRuntimeStatus();
  }

  private updateTabStatus(tabId: string, status: Tab["status"]): void {
    const tab = this.state.getState().tabs.find((candidate) => candidate.id === tabId);
    if (!tab || tab.status === "hibernated") return;
    this.state.updateTab(tabId, { status });
    this.publish();
    this.publishRuntimeStatus();
  }

  private loadTabURL(view: WebContentsView, url: string): Promise<void> {
    return view.webContents.loadURL(url === DEFAULT_URL ? NEW_TAB_URL : url);
  }

  private newSite(
    spaceId: string,
    origin: string,
    inspected: { cookieCount: number; storagePresent: boolean },
  ): SiteRecord {
    return {
      id: `${spaceId}:${origin}`,
      spaceId,
      origin,
      hostname: hostnameFor(origin),
      lastVisitedAt: new Date().toISOString(),
      credentialCount: this.vault
        .summaries(spaceId)
        .filter((credential) => credential.origin === origin).length,
      bookmarked: false,
      ...inspected,
      neverSaveCredentials: false,
    };
  }

  private attachTab(tabId: string | null): void {
    if (!tabId) {
      if (this.attachedTabId) {
        const previous = this.views.get(this.attachedTabId);
        if (previous) this.window.contentView.removeChildView(previous);
      }
      this.attachedTabId = null;
      this.publishRuntimeStatus();
      return;
    }
    const tab = this.state.getState().tabs.find((candidate) => candidate.id === tabId);
    if (!tab || tab.status === "hibernated") return;
    const next = this.views.get(tabId);
    if (!next) return;
    if (this.attachedTabId && this.attachedTabId !== tabId) {
      const previous = this.views.get(this.attachedTabId);
      if (previous) this.window.contentView.removeChildView(previous);
    }
    // Keep native page surfaces below the full-size chrome WebContentsView.
    this.window.contentView.removeChildView(next);
    this.window.contentView.addChildView(next, 0);
    this.attachedTabId = tabId;
    this.resizeAttachedView();
    this.publishRuntimeStatus();
  }

  private resizeAttachedView(): void {
    if (!this.attachedTabId) return;
    const view = this.views.get(this.attachedTabId);
    view?.setBounds(this.viewport);
  }

  private destroyView(tabId: string): void {
    const view = this.views.get(tabId);
    if (!view) return;
    this.window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
    this.views.delete(tabId);
    this.certificateErrors.delete(tabId);
    if (this.attachedTabId === tabId) this.attachedTabId = null;
    this.publishRuntimeStatus();
  }

  private findTabByWebContents(sender: WebContents): Tab | null {
    for (const [tabId, view] of this.views) {
      if (view.webContents.id === sender.id)
        return this.state.getState().tabs.find((tab) => tab.id === tabId) ?? null;
    }
    return null;
  }

  private requireView(tabId?: string): WebContentsView {
    const id = tabId ?? this.state.getState().activeTabId ?? "";
    const view = this.views.get(id);
    if (!view) throw new Error("The active tab is not ready");
    return view;
  }

  private requireTab(tabId?: string): Tab {
    const id = tabId ?? this.state.getState().activeTabId;
    const tab = this.state.getState().tabs.find((candidate) => candidate.id === id);
    if (!tab) throw new Error("No active tab");
    return tab;
  }

  private requireSpace(spaceId: string): Space {
    const space = this.getSpace(spaceId);
    if (!space) throw new Error("Space not found");
    return space;
  }

  private getSpace(spaceId: string): Space | null {
    return this.state.getState().spaces.find((space) => space.id === spaceId) ?? null;
  }

  private requireSite(siteId: string): SiteRecord {
    const site = this.state.getState().sites.find((candidate) => candidate.id === siteId);
    if (!site) throw new Error("Site not found");
    return site;
  }

  private findSite(spaceId: string, origin: string): SiteRecord | undefined {
    return this.state
      .getState()
      .sites.find((site) => site.spaceId === spaceId && site.origin === origin);
  }

  private publish(): void {
    this.emit({ type: "snapshot", snapshot: this.snapshot() });
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isLoginCandidate = (value: unknown): value is LoginCandidate =>
  isObject(value) &&
  typeof value.origin === "string" &&
  typeof value.hostname === "string" &&
  typeof value.username === "string" &&
  typeof value.password === "string" &&
  value.password.length > 0;

const isBrowserPageResponse = (value: unknown): value is BrowserPageResponse =>
  isObject(value) &&
  typeof value.requestId === "string" &&
  typeof value.ok === "boolean" &&
  (value.context === undefined || isObject(value.context)) &&
  (value.result === undefined || isObject(value.result));
