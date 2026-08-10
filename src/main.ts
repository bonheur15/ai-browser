import path from "node:path";
import { app, BaseWindow, ipcMain, nativeTheme, WebContentsView } from "electron";
import { AgentEvidenceStore } from "./ai/agent-evidence-store";
import { AgentRuntime } from "./ai/agent-runtime";
import { AgentStateStore } from "./ai/agent-state-store";
import { registerAgentIPC } from "./main/agent-ipc";
import { BrowserRuntime } from "./main/browser-runtime";
import { registerBrowserIPC } from "./main/ipc";
import { SecretVault } from "./main/secret-vault";
import { SpaceSessionManager } from "./main/space-session-manager";
import { AppStateStore } from "./main/state-store";

let mainWindow: BaseWindow | null = null;
let browserRuntime: BrowserRuntime | null = null;
let stateStore: AppStateStore | null = null;
let secretVault: SecretVault | null = null;
let agentStateStore: AgentStateStore | null = null;
let agentEvidenceStore: AgentEvidenceStore | null = null;
let agentRuntime: AgentRuntime | null = null;
let isQuitting = false;

const isDevelopment = process.argv.includes("--dev");

const requireInitialized = <T>(value: T | null, name: string): T => {
  if (!value) throw new Error(`${name} is not initialized`);
  return value;
};

const createWindow = async (): Promise<void> => {
  mainWindow = new BaseWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#0b0e12",
    transparent: false,
  });

  const window = mainWindow;
  window.setBackgroundColor("#0b0e12");
  window.contentView.setBackgroundColor("#0b0e12");
  const chrome = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // The chrome view sits above the native browser page views. Keep its
  // backing surface transparent so the active page remains visible through
  // the viewport while the shell controls still paint their own surfaces.
  chrome.setBackgroundColor("#00000000");
  window.contentView.addChildView(chrome);

  const resizeChrome = (): void => {
    if (window.isDestroyed()) return;
    const bounds = window.getContentBounds();
    chrome.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
  };
  resizeChrome();
  window.on("resize", resizeChrome);
  window.on("maximize", resizeChrome);
  window.on("unmaximize", resizeChrome);
  window.on("restore", resizeChrome);

  chrome.webContents.on("did-finish-load", () => {
    console.log(`[renderer] loaded ${chrome.webContents.getURL() || "unknown URL"}`);
    if (!window.isDestroyed()) window.show();
  });
  chrome.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer] failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });
  chrome.webContents.on("console-message", (details) => {
    if (details.level === "error") {
      console.error(`[renderer:${details.sourceId}:${details.lineNumber}] ${details.message}`);
    }
  });

  const initializedStateStore = requireInitialized(stateStore, "App state store");
  const initializedSecretVault = requireInitialized(secretVault, "Secret vault");
  const initializedAgentStateStore = requireInitialized(agentStateStore, "Agent state store");
  const initializedEvidenceStore = requireInitialized(agentEvidenceStore, "Agent evidence store");
  const runtime = new BrowserRuntime(
    window,
    initializedStateStore,
    new SpaceSessionManager(),
    initializedSecretVault,
    (event) => {
      if (!chrome.webContents.isDestroyed()) chrome.webContents.send("browser:event", event);
    },
  );
  browserRuntime = runtime;
  registerBrowserIPC(window, runtime);
  const agents = new AgentRuntime(
    runtime,
    initializedAgentStateStore,
    initializedEvidenceStore,
    (event) => {
      if (!chrome.webContents.isDestroyed()) chrome.webContents.send("agent:event", event);
    },
  );
  agentRuntime = agents;
  registerAgentIPC(window, agents);
  await agents.initialize();
  await runtime.initialize();

  if (isDevelopment) {
    await chrome.webContents.loadURL("http://127.0.0.1:5173");
  } else {
    await chrome.webContents.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  window.on("closed", () => {
    if (!chrome.webContents.isDestroyed()) chrome.webContents.close();
    browserRuntime = null;
    agentRuntime = null;
    mainWindow = null;
  });
};

ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:toggle-maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on("window:close", () => mainWindow?.close());
ipcMain.handle("window:is-maximized", () => mainWindow?.isMaximized() ?? false);

app
  .whenReady()
  .then(async () => {
    nativeTheme.themeSource = "dark";
    stateStore = new AppStateStore(path.join(app.getPath("userData"), "app-state.json"));
    secretVault = new SecretVault(path.join(app.getPath("userData"), "vault.enc"));
    agentStateStore = new AgentStateStore(path.join(app.getPath("userData"), "agent-state.json"));
    agentEvidenceStore = new AgentEvidenceStore(
      path.join(app.getPath("userData"), "agent-evidence"),
    );
    await stateStore.load();
    await secretVault.load();
    await agentStateStore.load();
    await agentEvidenceStore.load();
    await createWindow();

    app.on("activate", () => {
      if (BaseWindow.getAllWindows().length === 0) void createWindow();
    });
  })
  .catch((error: unknown) => {
    console.error("[app] unable to initialize", error);
    app.quit();
  });

app.on("before-quit", (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  const shutdownAgent = agentRuntime?.shutdown() ?? Promise.resolve();
  browserRuntime?.dispose();
  const flushBrowser = browserRuntime?.flush() ?? Promise.resolve();
  void Promise.all([shutdownAgent, flushBrowser]).finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
