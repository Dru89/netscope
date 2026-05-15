import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export type HarFileData = {
  filePath: string;
  content: string;
  fileName: string;
};

const isElectron = () =>
  typeof window !== "undefined" && !!window.electronAPI;

export async function openFileDialog(): Promise<HarFileData | null> {
  if (isElectron()) return window.electronAPI.openFileDialog();

  const filePath = await dialogOpen({
    multiple: false,
    filters: [{ name: "HAR Files", extensions: ["har"] }],
  });
  if (!filePath || typeof filePath !== "string") return null;
  const content = await readTextFile(filePath);
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  return { filePath, content, fileName };
}

export async function readHarFile(
  filePath: string,
): Promise<HarFileData | null> {
  if (isElectron()) return window.electronAPI.readHarFile(filePath);

  const content = await readTextFile(filePath);
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  return { filePath, content, fileName };
}

export async function setThemeMode(
  mode: "system" | "light" | "dark",
): Promise<void> {
  if (isElectron()) return window.electronAPI.setThemeMode(mode);

  await getCurrentWindow().setTheme(mode === "system" ? null : mode);
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

  // Phase 2: Rust emits 'har-file-opened' for CLI args and file associations
  let unlisten: (() => void) | undefined;
  listen<HarFileData>("har-file-opened", (event) => {
    callback(event.payload);
  }).then((fn) => {
    unlisten = fn;
  });
  return () => unlisten?.();
}

export async function getStartupFile(): Promise<HarFileData | null> {
  if (isElectron()) return null;
  return invoke<HarFileData | null>("get_startup_file");
}

export function onRequestOpenFile(callback: () => void): () => void {
  if (isElectron()) return () => {};
  let unlisten: (() => void) | undefined;
  listen<null>("request-open-file", () => callback()).then((fn) => {
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
