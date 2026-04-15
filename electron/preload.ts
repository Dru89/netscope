import { contextBridge, ipcRenderer, webUtils } from "electron";

export interface HarFileData {
  filePath: string;
  content: string;
  fileName: string;
}

contextBridge.exposeInMainWorld("electronAPI", {
  openFileDialog: (): Promise<HarFileData | null> =>
    ipcRenderer.invoke("open-file-dialog"),
  readHarFile: (filePath: string): Promise<HarFileData | null> =>
    ipcRenderer.invoke("read-har-file", filePath),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  getNativeTheme: (): Promise<"dark" | "light"> =>
    ipcRenderer.invoke("get-native-theme"),
  setThemeMode: (mode: "system" | "light" | "dark"): Promise<void> =>
    ipcRenderer.invoke("set-theme-mode", mode),
  signalReady: (): void => {
    ipcRenderer.send("renderer-ready");
  },
  onHarFileOpened: (callback: (data: HarFileData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: HarFileData) =>
      callback(data);
    ipcRenderer.on("har-file-opened", handler);
    return () => ipcRenderer.removeListener("har-file-opened", handler);
  },
  onThemeChanged: (callback: (theme: "dark" | "light") => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      theme: "dark" | "light",
    ) => callback(theme);
    ipcRenderer.on("theme-changed", handler);
    return () => ipcRenderer.removeListener("theme-changed", handler);
  },
});
