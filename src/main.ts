import { app, BaseWindow, WebContentsView, ipcMain, nativeTheme } from "electron";
import path from "node:path";
import { BrowserRuntime } from "./main/browser-runtime";
import { registerBrowserIPC } from "./main/ipc";
import { registerAgentIPC } from "./main/agent-ipc";
import { AgentRuntime } from "./ai/agent-runtime";
import { AgentStateStore } from "./ai/agent-state-store";
import { AgentEvidenceStore } from "./ai/agent-evidence-store";
import { SpaceSessionManager } from "./main/space-session-manager";
import { SecretVault } from "./main/secret-vault";
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
  });

  const window = mainWindow;
  const chrome = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  chrome.setBackgroundColor("#0b0e12");
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

  const runtime = new BrowserRuntime(
    window,
    stateStore!,
    new SpaceSessionManager(),
    secretVault!,
    (event) => {
      if (!chrome.webContents.isDestroyed()) chrome.webContents.send("browser:event", event);
    },
  );
  browserRuntime = runtime;
  registerBrowserIPC(window, runtime);
  const agents = new AgentRuntime(
    runtime,
    agentStateStore!,
    agentEvidenceStore!,
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

app.whenReady().then(async () => {
  nativeTheme.themeSource = "dark";
  stateStore = new AppStateStore(path.join(app.getPath("userData"), "app-state.json"));
  secretVault = new SecretVault(path.join(app.getPath("userData"), "vault.enc"));
  agentStateStore = new AgentStateStore(path.join(app.getPath("userData"), "agent-state.json"));
  agentEvidenceStore = new AgentEvidenceStore(path.join(app.getPath("userData"), "agent-evidence"));
  await stateStore.load();
  await secretVault.load();
  await agentStateStore.load();
  await agentEvidenceStore.load();
  await createWindow();

  app.on("activate", () => {
    if (BaseWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((error: unknown) => {
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
