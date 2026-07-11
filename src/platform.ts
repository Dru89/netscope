import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import type { HarEntry, SortDirection, SortField } from "./types/har";
import {
  getResponseBody,
  toCurl,
  toFetch,
  toFetchNode,
  toPowerShell,
} from "./utils/copyFormatters";

export type HarFileData = {
  filePath: string;
  content: string;
  fileName: string;
};

export type RequestContextMenuData = {
  entry: HarEntry;
  allEntries: HarEntry[];
  sortField: SortField;
  sortDirection: SortDirection;
};

const isElectron = () =>
  typeof window !== "undefined" && !!window.electronAPI;

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function openFileDialog(): Promise<HarFileData | null> {
  if (isElectron()) return window.electronAPI.openFileDialog();
  if (!isTauri()) return null;

  const selection = await dialogOpen({
    multiple: true,
    filters: [
      { name: "HAR Files", extensions: ["har"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (!selection) return null;
  const paths = Array.isArray(selection) ? selection : [selection];
  // First file loads into the calling window (via the return value);
  // any additional selections open their own windows, deduped in Rust.
  if (paths.length > 1) {
    void invoke("open_paths_in_new_windows", { paths: paths.slice(1) });
  }
  return readHarFile(paths[0]);
}

// Reads through Rust rather than the fs plugin: the plugin's scope only
// covers dialog-selected paths, but drops, recent files, and CLI args hand
// us arbitrary paths, and a local file viewer must be able to read them.
export async function readHarFile(
  filePath: string,
): Promise<HarFileData | null> {
  if (isElectron()) return window.electronAPI.readHarFile(filePath);
  if (!isTauri()) return null;

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
  if (!isTauri()) return;

  await getCurrentWindow().setTheme(mode === "system" ? null : mode);
}

export async function setWindowTitle(title: string): Promise<void> {
  if (isElectron()) return; // Electron main process sets the title
  if (!isTauri()) return;
  await getCurrentWindow().setTitle(title);
}

// Signals that the renderer has parsed and painted its content. Windows are
// created hidden and shown on this signal (or a timeout) so opening a file
// never flashes the welcome screen.
export function signalReady(): void {
  if (isElectron()) {
    window.electronAPI.signalReady();
    return;
  }
  if (!isTauri()) return;
  void invoke("signal_ready");
}

// The native context menu round-trip (Tauri): Rust pops the menu; copy
// actions come back as a context-menu-action event and are resolved here,
// where the entry data already lives and the pure copy formatters run.
// The formatted text goes back to Rust only to reach the clipboard.
let contextMenuData: RequestContextMenuData | null = null;
let contextMenuListenerReady = false;

export function showRequestContextMenu(data: RequestContextMenuData): void {
  if (isElectron()) {
    window.electronAPI.showRequestContextMenu(data);
    return;
  }
  if (!isTauri()) return;

  contextMenuData = data;
  if (!contextMenuListenerReady) {
    contextMenuListenerReady = true;
    void listen<{ targetLabel: string; action: string }>(
      "context-menu-action",
      (event) => {
        if (event.payload.targetLabel !== getCurrentWindow().label) return;
        handleContextMenuCopy(event.payload.action);
      },
    );
  }
  void invoke("show_request_context_menu", {
    url: data.entry.request.url,
    sortField: data.sortField,
    sortDirection: data.sortDirection,
  });
}

function handleContextMenuCopy(action: string): void {
  const data = contextMenuData;
  if (!data) return;
  const { entry, allEntries } = data;
  const joinAll = (format: (e: HarEntry) => string) =>
    allEntries.map(format).join("\n\n");

  let text: string | null = null;
  switch (action) {
    case "copy_url":
      text = entry.request.url;
      break;
    case "copy_curl":
      text = toCurl(entry);
      break;
    case "copy_fetch":
      text = toFetch(entry);
      break;
    case "copy_fetch_node":
      text = toFetchNode(entry);
      break;
    case "copy_powershell":
      text = toPowerShell(entry);
      break;
    case "copy_response":
      text = getResponseBody(entry);
      break;
    case "copy_all_urls":
      text = allEntries.map((e) => e.request.url).join("\n");
      break;
    case "copy_all_curl":
      text = joinAll(toCurl);
      break;
    case "copy_all_fetch":
      text = joinAll(toFetch);
      break;
    case "copy_all_fetch_node":
      text = joinAll(toFetchNode);
      break;
    case "copy_all_powershell":
      text = joinAll(toPowerShell);
      break;
  }
  if (text !== null) {
    void invoke("set_clipboard", { text });
  }
}

export function onHarFileOpened(
  callback: (data: HarFileData) => void,
): () => void {
  if (isElectron()) return window.electronAPI.onHarFileOpened(callback);
  if (!isTauri()) return () => {};

  // Rust emits this when it loads a file into an existing window (welcome-
  // window reuse for OS opens). The payload carries a target label because
  // emit_to still broadcasts to every window — ignore other windows' files.
  let unlisten: (() => void) | undefined;
  listen<HarFileData & { targetLabel?: string }>(
    "har-file-opened",
    (event) => {
      const { targetLabel } = event.payload;
      if (targetLabel && targetLabel !== getCurrentWindow().label) return;
      callback(event.payload);
    },
  ).then((fn) => {
    unlisten = fn;
  });
  return () => unlisten?.();
}

// Fetch the file pre-assigned to this window on startup (CLI arg or file association).
export async function getWindowFile(): Promise<HarFileData | null> {
  if (!isTauri()) return null;
  return invoke<HarFileData | null>("get_window_file");
}

// Tell Rust which file this window has loaded, for dedup when another window
// tries to open the same file (also updates the recent-files list and the
// macOS proxy icon).
export async function registerOpenFile(filePath: string): Promise<void> {
  if (!isTauri()) return;
  return invoke("register_open_file", { filePath });
}

// Open a file in a new window. If the file is already open somewhere, focuses
// that window instead.
export async function openFileInNewWindow(data: HarFileData): Promise<void> {
  if (!isTauri()) return;
  return invoke("open_file_in_new_window", {
    filePath: data.filePath,
    content: data.content,
    fileName: data.fileName,
  });
}

// Save text (or base64-encoded binary) to a user-chosen location.
// Tauri: native save dialog + Rust write. Elsewhere: browser download.
export async function saveFile(
  suggestedName: string,
  contents: string,
  base64 = false,
): Promise<void> {
  if (isTauri()) {
    const path = await dialogSave({ defaultPath: suggestedName });
    if (!path) return;
    await invoke("save_file", { path, contents, base64 });
    return;
  }
  const bytes = base64
    ? Uint8Array.from(atob(contents.trim()), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(contents);
  const blob = new Blob([bytes]);
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = suggestedName;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

export function onRequestOpenFile(callback: () => void): () => void {
  if (isElectron() || !isTauri()) return () => {};
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
  if (!isTauri()) return () => {};

  let unlisten: (() => void) | undefined;
  listen<{ targetLabel?: string; field: string; direction: string }>(
    "context-menu-sort",
    (event) => {
      const { targetLabel } = event.payload;
      if (targetLabel && targetLabel !== getCurrentWindow().label) return;
      callback(event.payload);
    },
  ).then((fn) => {
    unlisten = fn;
  });
  return () => unlisten?.();
}
