import { type BaseWindow, ipcMain } from "electron";
import type { BrowserCommand, BrowserViewportBounds } from "../shared/contracts";
import type { BrowserRuntime } from "./browser-runtime";

const COMMAND_TYPES = new Set([
  "space.create",
  "space.rename",
  "space.updateAppearance",
  "space.delete",
  "space.select",
  "space.createPrivate",
  "tab.create",
  "tab.activate",
  "tab.close",
  "tab.cloneToSpace",
  "tab.moveToSpace",
  "tab.hibernate",
  "tab.restore",
  "navigation.back",
  "navigation.forward",
  "navigation.reload",
  "navigation.search",
  "bookmark.create",
  "bookmark.remove",
  "site.inspect",
  "site.clearData",
  "site.forget",
  "credential.save",
  "credential.reject",
  "credential.fill",
  "credential.remove",
]);

export const registerBrowserIPC = (window: BaseWindow, runtime: BrowserRuntime): void => {
  ipcMain.handle("browser:get-snapshot", () => runtime.snapshot());
  ipcMain.handle("browser:dispatch", (_event, command: unknown) => {
    if (!isBrowserCommand(command)) {
      return { ok: false, error: "Invalid browser command", snapshot: runtime.snapshot() };
    }
    return runtime.dispatch(command);
  });
  ipcMain.on("browser:set-viewport", (_event, bounds: unknown) => {
    if (isViewport(bounds)) runtime.setViewport(bounds);
  });
  ipcMain.on("browser:login-candidate", (event, candidate: unknown) => {
    runtime.handleLoginCandidate(event.sender, candidate);
  });
  ipcMain.on("browser:credential-fill-result", (event, result: unknown) => {
    runtime.handleCredentialFillResult(event.sender, result);
  });
  ipcMain.on("browser:agent-page-response", (event, response: unknown) => {
    runtime.handleAgentPageResponse(event.sender, response);
  });

  window.on("closed", () => {
    ipcMain.removeHandler("browser:get-snapshot");
    ipcMain.removeHandler("browser:dispatch");
    ipcMain.removeAllListeners("browser:set-viewport");
    ipcMain.removeAllListeners("browser:login-candidate");
    ipcMain.removeAllListeners("browser:credential-fill-result");
    ipcMain.removeAllListeners("browser:agent-page-response");
  });
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isBrowserCommand = (value: unknown): value is BrowserCommand =>
  isObject(value) && typeof value.type === "string" && COMMAND_TYPES.has(value.type);

const isViewport = (value: unknown): value is BrowserViewportBounds =>
  isObject(value) &&
  typeof value.x === "number" &&
  typeof value.y === "number" &&
  typeof value.width === "number" &&
  typeof value.height === "number" &&
  value.width > 0 &&
  value.height > 0;
