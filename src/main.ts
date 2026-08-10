import { app, BrowserWindow, ipcMain, shell, WebContentsView } from "electron";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;
let googleView: WebContentsView | null = null;
const isDevelopment = process.argv.includes("--dev");

const TITLEBAR_HEIGHT = 44;

const resizeGoogleView = (): void => {
  if (!mainWindow || !googleView) return;

  const [width, height] = mainWindow.getContentSize();
  googleView.setBounds({
    x: 0,
    y: TITLEBAR_HEIGHT,
    width,
    height: Math.max(0, height - TITLEBAR_HEIGHT),
  });
};

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#0d0f12",
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  googleView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.contentView.addChildView(googleView);
  resizeGoogleView();
  mainWindow.on("resize", resizeGoogleView);

  googleView.webContents.on("did-finish-load", () => {
    console.log(`[browser] loaded ${googleView?.webContents.getURL() ?? "Google"}`);
  });
  googleView.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[browser] failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });
  googleView.webContents.setWindowOpenHandler(({ url }) => {
    void googleView?.webContents.loadURL(url);
    return { action: "deny" };
  });
  void googleView.webContents.loadURL("https://www.google.com").catch((error: unknown) => {
    console.error("[browser] unable to load Google", error);
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

  if (isDevelopment) {
    void mainWindow.loadURL("http://127.0.0.1:5173").catch((error: unknown) => {
      console.error("[renderer] unable to load development server", error);
    });
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html")).catch((error: unknown) => {
      console.error("[renderer] unable to load packaged application", error);
    });
  }

  mainWindow.on("closed", () => {
    googleView = null;
    mainWindow = null;
  });
};

ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:toggle-maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.on("window:close", () => mainWindow?.close());
ipcMain.handle("window:is-maximized", () => mainWindow?.isMaximized() ?? false);

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
