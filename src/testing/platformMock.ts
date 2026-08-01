// A stand-in for every export of src/platform.ts.
//
// platform.ts is the only module allowed to import @tauri-apps/*, which is
// what makes the renderer testable in jsdom at all: mock this one module and
// the entire native boundary becomes assertable. Keep this in sync with
// platform.ts — a missing export shows up as an unhelpful "not a function".
//
// The listener registrars must return a cleanup function; App passes their
// return value straight to useEffect.

import { vi } from "vitest";

export function platformMock() {
  const noopCleanup = () => () => {};
  return {
    pickAndOpenFiles: vi.fn(async () => {}),
    readHarFile: vi.fn(async () => null),
    isNativeDropHandled: vi.fn(() => false),
    onFileDrop: vi.fn(noopCleanup),
    setThemeMode: vi.fn(async () => {}),
    broadcastThemeMode: vi.fn(async () => {}),
    onThemeModeChanged: vi.fn(noopCleanup),
    setWindowTitle: vi.fn(async () => {}),
    signalReady: vi.fn(),
    showRequestContextMenu: vi.fn(),
    onHarFileOpened: vi.fn(noopCleanup),
    getWindowFile: vi.fn(async () => null),
    registerOpenFile: vi.fn(async () => {}),
    saveFile: vi.fn(async () => {}),
    onContextMenuSort: vi.fn(noopCleanup),
  };
}
