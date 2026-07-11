# Architecture

Netscope is a Tauri 2 app: a Rust shell owning every native concern, and a
React renderer that never touches the OS directly.

```
┌──────────────────────────────────────────────────────────┐
│ Rust shell (src-tauri/src/)                              │
│  windows.rs   window mgmt, cascade, dedup, welcome reuse │
│  menu.rs      native menus (rebuilt on state changes)    │
│  context_menu.rs  request-row context menu               │
│  recent.rs    Open Recent + OS recent documents          │
│  update.rs    prompted auto-update, restore-after-update │
│  prefs.rs     preferences.json (app-data dir)            │
│  state.rs     AppState maps                              │
│  lib.rs       commands, plugins, startup, RunEvents      │
└───────────────▲──────────────────────────┬───────────────┘
   #[tauri::command] invocations      events (targetLabel-tagged)
┌───────────────┴──────────────────────────▼───────────────┐
│ Renderer (src/)                                          │
│  platform.ts  the ONLY file importing @tauri-apps/*      │
│  App.tsx      all application state                      │
│  components/  presentational components                  │
│  utils/       pure, tested parsing/filtering/formatting  │
└──────────────────────────────────────────────────────────┘
```

## The platform seam

`src/platform.ts` exposes named functions (openFileDialog, readHarFile,
onFileDrop, signalReady, showRequestContextMenu, saveFile, …). Each one
no-ops when Tauri isn't present, so the renderer runs in a plain browser
for development (`npx vite`, then `?fixture=/test/fixtures/x.har`).

Commands defined in `lib.rs`: `read_har_file`, `get_window_file`,
`register_open_file`, `open_file_in_new_window`,
`open_paths_in_new_windows`, `new_window`, `signal_ready`,
`show_request_context_menu`, `set_clipboard`, `save_file`.

File reads go through `read_har_file` (Rust) rather than the fs plugin:
plugin scopes only cover dialog-selected paths, but drops, recent files,
and CLI args hand the app arbitrary paths.

Events Rust → renderer: `har-file-opened`, `request-open-file`,
`context-menu-action`, `context-menu-sort`. `emit_to` broadcasts to every
window in Tauri 2, so payloads carry a `targetLabel` that the renderer
compares against its own window label (or an `isFocused()` guard for
`request-open-file`).

## Window lifecycle

All windows are created from Rust (`windows::create_window`) — none in
`tauri.conf.json` — so every window gets identical treatment:

- **Hidden until ready:** windows are built with `visible(false)` and shown
  when the renderer invokes `signal_ready` after parsing and painting
  (800ms timeout as a safety net). No welcome-screen flash when opening a
  file, no white flash in dark mode.
- **Cascade:** 28px down-right from the focused window. Positions are
  tracked in an explicit map (seeded from our own position hints, updated
  from `Moved` events) because `outer_position()` fails on Wayland.
- **Dedup:** `open_files: label → canonical path`. Every open path checks
  it first and focuses the existing window.
- **Welcome reuse:** OS-driven opens load into a _focused_ empty welcome
  window (or the sole empty window during launch) instead of leaving one
  behind. An unfocused welcome window is never taken over.
- **Pending files:** a file assigned at window creation is stashed in
  `pending_files` and pulled by the renderer on mount (`get_window_file`),
  which also makes webview reloads restore the file.

Open paths that all converge on the same logic: the Open dialog
(multi-select), Open Recent, drag-drop (native paths from
`onDragDropEvent`), CLI arguments, second launches (single-instance
handoff on Windows/Linux), and macOS `RunEvent::Opened`.

## Quit model

Windows/Linux exit when the last window closes (Tauri default). On macOS
`ExitRequested { code: None }` is prevented so the app stays running, and
`RunEvent::Reopen` (dock click) creates a fresh welcome window.

## Auto-update

See `update.rs`: prompted flow (Install / Remind Me Later / Skip This
Version) persisted in `preferences.json`, taskbar download progress,
About-panel status, and restore-open-files across the update restart.
Stable builds poll `releases/latest/download/latest.json`; nightly builds
are pointed at a rolling `nightly` release manifest at build time. Linux
self-update only applies to the AppImage; deb/pacman installs update
through the package manager.

## Renderer

React 19 + Vite. All state lives in `App.tsx` and flows down as props —
no external state library. `filteredEntries`/`sortedEntries` are memoized
so selection changes don't re-filter large captures. The table renders
every row as real DOM (no virtualization — measured fine at 10k entries
for interaction; a filter keystroke costs ~500ms there, the accepted
tradeoff).

Styling is plain CSS on the `--ns-*` token set (`src/styles/tokens.css`,
the "Instrument" design system). Theme: explicit Light/Dark sets
`data-theme` on `<html>` before first paint (index.html script + App
effect); System mode removes the attribute and `prefers-color-scheme`
decides.
