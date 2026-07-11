import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export type HarFileData = {
  filePath: string;
  content: string;
  fileName: string;
};

const isElectron = () =>
  typeof window !== "undefined" && !!window.electronAPI;

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function openFileDialog(): Promise<HarFileData | null> {
  if (isElectron()) return window.electronAPI.openFileDialog();

  const filePath = await dialogOpen({
    multiple: false,
    filters: [{ name: "HAR Files", extensions: ["har"] }],
  });
  if (!filePath || typeof filePath !== "string") return null;
  return readHarFile(filePath);
}

// Reads through Rust rather than the fs plugin: the plugin's scope only
// covers dialog-selected paths, but drops, recent files, and CLI args hand
// us arbitrary paths, and a local file viewer must be able to read them.
export async function readHarFile(
  filePath: string,
): Promise<HarFileData | null> {
  if (isElectron()) return window.electronAPI.readHarFile(filePath);

  return invoke<HarFileData | null>("read_har_file", { path: filePath });
}

// Real filesystem paths for DOM-dropped files exist only in Electron
// (webUtils.getPathForFile). Plain-browser dev returns null and the caller
// falls back to FileReader; Tauri drops never reach the DOM (see onFileDrop).
export function getPathForFile(file: File): string | null {
  if (isElectron()) return window.electronAPI.getPathForFile(file) || null;
  return null;
}

// Tauri's webview intercepts file drags natively (dragDropEnabled default),
// so the DOM drop handler must not also process them.
export function isNativeDropHandled(): boolean {
  return isTauri();
}

// Native drag-drop (Tauri only): delivers the real path so dropped files can
// be registered for dedup like every other open path.
export function onFileDrop(
  callback: (data: HarFileData) => void,
): () => void {
  if (!isTauri()) return () => {};
  let unlisten: (() => void) | undefined;
  getCurrentWebview()
    .onDragDropEvent((event) => {
      if (event.payload.type === "drop" && event.payload.paths.length > 0) {
        void readHarFile(event.payload.paths[0]).then((data) => {
          if (data) callback(data);
        });
      }
    })
    .then((fn) => {
      unlisten = fn;
    });
  return () => unlisten?.();
}

export async function setThemeMode(
  mode: "system" | "light" | "dark",
): Promise<void> {
  if (isElectron()) return window.electronAPI.setThemeMode(mode);

  await getCurrentWindow().setTheme(mode === "system" ? null : mode);
}

export async function setWindowTitle(title: string): Promise<void> {
  if (isElectron()) return; // Electron main process sets the title
  await getCurrentWindow().setTitle(title);
}

export function signalReady(): void {
  if (isElectron()) {
    window.electronAPI.signalReady();
    return;
  }
  void getCurrentWindow().show();
}

export function showRequestContextMenu(_data: unknown): void {
  if (isElectron()) {
    window.electronAPI.showRequestContextMenu(_data);
    return;
  }
  // Phase 2: native context menu via tauri-plugin-menu
}

export function onHarFileOpened(
  callback: (data: HarFileData) => void,
): () => void {
  if (isElectron()) return window.electronAPI.onHarFileOpened(callback);

  // Phase 2: Rust emits 'har-file-opened' for file associations on macOS
  let unlisten: (() => void) | undefined;
  listen<HarFileData>("har-file-opened", (event) => {
    callback(event.payload);
  }).then((fn) => {
    unlisten = fn;
  });
  return () => unlisten?.();
}

// Fetch the file pre-assigned to this window on startup (CLI arg or file association).
export async function getWindowFile(): Promise<HarFileData | null> {
  if (isElectron()) return null;
  return invoke<HarFileData | null>("get_window_file");
}

// Tell Rust which file this window has loaded, for dedup when another window
// tries to open the same file.
export async function registerOpenFile(filePath: string): Promise<void> {
  if (isElectron()) return;
  return invoke("register_open_file", { filePath });
}

// Open a file in a new window. If the file is already open somewhere, focuses
// that window instead.
export async function openFileInNewWindow(data: HarFileData): Promise<void> {
  if (isElectron()) return;
  return invoke("open_file_in_new_window", {
    filePath: data.filePath,
    content: data.content,
    fileName: data.fileName,
  });
}

export async function newWindow(): Promise<void> {
  if (isElectron()) return;
  return invoke("new_window");
}

export async function closeWindow(): Promise<void> {
  if (isElectron()) return;
  await getCurrentWindow().close();
}

export function onRequestOpenFile(callback: () => void): () => void {
  if (isElectron()) return () => {};
  let unlisten: (() => void) | undefined;
  // Tauri 2's emit_to(EventTarget::WebviewWindow) still broadcasts to all
  // windows, so every window receives this event. Guard with isFocused() so
  // only the focused window acts on it.
  listen<null>("request-open-file", () => {
    void getCurrentWindow().isFocused().then((focused) => {
      if (focused) callback();
    });
  }).then((fn) => {
    unlisten = fn;
  });
  return () => unlisten?.();
}

export function onContextMenuSort(
  callback: (sort: { field: string; direction: string }) => void,
): () => void {
  if (isElectron()) return window.electronAPI.onContextMenuSort(callback);

  // Phase 2: Rust emits 'context-menu-sort' from native context menu
  let unlisten: (() => void) | undefined;
  listen<{ field: string; direction: string }>("context-menu-sort", (event) => {
    callback(event.payload);
  }).then((fn) => {
    unlisten = fn;
  });
  return () => unlisten?.();
}
