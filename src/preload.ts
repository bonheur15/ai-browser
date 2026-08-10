import { contextBridge, ipcRenderer } from "electron";
import type { BrowserAPI, BrowserCommand, BrowserEvent, BrowserViewportBounds } from "./shared/contracts";
import type { AgentAPI, AgentCommand, AgentEvent } from "./shared/agent-contracts";

contextBridge.exposeInMainWorld("windowControls", {
  minimize: (): void => ipcRenderer.send("window:minimize"),
  toggleMaximize: (): void => ipcRenderer.send("window:toggle-maximize"),
  close: (): void => ipcRenderer.send("window:close"),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:is-maximized"),
});

const browserAPI: BrowserAPI = {
  getSnapshot: () => ipcRenderer.invoke("browser:get-snapshot"),
  dispatch: (command: BrowserCommand) => ipcRenderer.invoke("browser:dispatch", command),
  subscribe: (listener: (event: BrowserEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: BrowserEvent): void => listener(event);
    ipcRenderer.on("browser:event", handler);
    return () => ipcRenderer.removeListener("browser:event", handler);
  },
  setBrowserViewport: (bounds: BrowserViewportBounds): void => ipcRenderer.send("browser:set-viewport", bounds),
};

contextBridge.exposeInMainWorld("browserAPI", browserAPI);

const agentAPI: AgentAPI = {
  getSnapshot: () => ipcRenderer.invoke("agent:get-snapshot"),
  dispatch: (command: AgentCommand) => ipcRenderer.invoke("agent:dispatch", command),
  getEvidence: (id: string) => ipcRenderer.invoke("agent:get-evidence", id),
  subscribe: (listener: (event: AgentEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: AgentEvent): void => listener(event);
    ipcRenderer.on("agent:event", handler);
    return () => ipcRenderer.removeListener("agent:event", handler);
  },
};

contextBridge.exposeInMainWorld("agentAPI", agentAPI);
