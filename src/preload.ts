import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("windowControls", {
  minimize: (): void => ipcRenderer.send("window:minimize"),
  toggleMaximize: (): void => ipcRenderer.send("window:toggle-maximize"),
  close: (): void => ipcRenderer.send("window:close"),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:is-maximized"),
});
