import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { BrowserRuntime } from "./main/browser-runtime";
import { registerBrowserIPC } from "./main/ipc";
import { SpaceSessionManager } from "./main/space-session-manager";
import { SecretVault } from "./main/secret-vault";
import { AppStateStore } from "./main/state-store";

let mainWindow: BrowserWindow | null = null;
let browserRuntime: BrowserRuntime | null = null;
let stateStore: AppStateStore | null = null;
let secretVault: SecretVault | null = null;
let isQuitting = false;

const isDevelopment = process.argv.includes("--dev");

const createWindow = async (): Promise<void> => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#0b0e12",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.on("did-finish-load", () => {
    console.log(`[renderer] loaded ${mainWindow?.webContents.getURL() ?? "unknown URL"}`);
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer] failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });
  mainWindow.webContents.on("console-message", (details) => {
    if (details.level === "error") {
      console.error(`[renderer:${details.sourceId}:${details.lineNumber}] ${details.message}`);
    }
  });

  const window = mainWindow;
  const runtime = new BrowserRuntime(
    window,
    stateStore!,
    new SpaceSessionManager(),
    secretVault!,
    (event) => {
      if (!window.isDestroyed()) window.webContents.send("browser:event", event);
    },
  );
  browserRuntime = runtime;
  registerBrowserIPC(window, runtime);
  await runtime.initialize();

  if (isDevelopment) {
    await window.loadURL("http://127.0.0.1:5173");
  } else {
    await window.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  window.on("closed", () => {
    browserRuntime = null;
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
  stateStore = new AppStateStore(path.join(app.getPath("userData"), "app-state.json"));
  secretVault = new SecretVault(path.join(app.getPath("userData"), "vault.enc"));
  await stateStore.load();
  await secretVault.load();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((error: unknown) => {
  console.error("[app] unable to initialize", error);
  app.quit();
});

app.on("before-quit", (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  const flush = browserRuntime?.flush() ?? Promise.resolve();
  void flush.finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
