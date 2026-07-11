# Tauri Migration — Where It Stands

You started migrating Netscope from Electron to Tauri on the `nightly` branch a couple of
months ago, then set it down. This is an inventory of what got ported, what didn't, and the
signal for where you actually stopped. It feeds the "continue vs. start over" decision in the
Fable 5 brief.

**First, clear up a naming trap:** the commit says *"Scaffold Tauri 4.0.0."* That 4.0.0 is
the **Netscope app version**, not the Tauri version. The actual stack is **Tauri 2.x**
(`tauri = 2.11`, `@tauri-apps/api ^2.11`). Nothing here is on a Tauri 4.

## Branch shape

`nightly` = `main` (all the Electron work, merged in) **plus** four Tauri commits on top,
**plus** one uncommitted staged change:

```
d5e7ca2  Fix Ctrl+O opening file dialog once per window
611656b  Add native menus, startup file handling, and Type column fix
9b5d9e2  Port Electron IPC to Tauri platform abstraction
904fa9a  Scaffold Tauri 4.0.0 alongside Electron
        (+ uncommitted, staged: src-tauri/src/lib.rs, +74/-9)
```

Electron was **not** removed. Both runtimes coexist. The renderer detects which one it's in
at runtime via `src/platform.ts` (`isElectron()` → `!!window.electronAPI`), and the whole
React app, HAR parsing, filter engine, copy formatters, and unit tests are shared, untouched,
and platform-agnostic. So "the migration" is entirely about re-implementing the **shell**
(the `electron/main.ts` responsibilities) in Rust — the UI half was already portable.

## Where you actually stopped

The uncommitted, staged change to `src-tauri/src/lib.rs` is the cascade-window-positioning
logic, and its comments are all about Wayland vs. X11: `outer_position()` failing on Wayland,
`WindowEvent::Moved` reporting compositor-relative coordinates, seeding a `window_positions`
map because the OS won't reliably tell you where a window landed. **You stopped mid-fight with
Linux/Wayland window positioning** — a genuinely annoying, low-glory corner of native window
management. That's a very plausible place to lose momentum. It is not a sign the approach was
wrong; it's a sign you hit the tedious part.

## What's ported (works in the Tauri build)

- **Tauri 2 scaffold** wired to the existing Vite/React frontend; the window opens and renders.
- **`src/platform.ts` abstraction** — every former `window.electronAPI.*` call is now a named
  function that branches Electron vs. Tauri. `App.tsx` imports from `platform`, not from
  `window.electronAPI`.
- **Multi-window creation** in Rust (`create_window`, `new_window`,
  `open_file_in_new_window`).
- **Cascade positioning**, including the careful Wayland/X11 handling (this is the part still
  being finished).
- **File dedup** — `open_files: HashMap<label, PathBuf>`; opening an already-open file focuses
  the existing window (`find_window_for_file` + `set_focus`).
- **Pending-file handoff** — a file assigned to a window at creation is stashed in
  `pending_files` and pulled by the frontend on mount via the `get_window_file` command.
- **`register_open_file`** so the frontend can tell Rust which file a window ended up showing
  (keeps dedup correct for dialog/drag opens).
- **Quit-on-last-window** on Linux/Windows (`active_windows` counter; `app.exit(0)` at zero,
  `#[cfg(not(macos))]`).
- **Native menus** — File menu with New Window / Open… / Close / Quit, plus the standard macOS
  app menu (About / Services / Hide / Quit). Menu "Open" routes to the focused window through a
  `request-open-file` event.
- **CLI-arg startup file** — `argv[1]` is read at launch and served through the pending-file
  path (Linux/Windows only).
- **Theme set** via `getCurrentWindow().setTheme()`.
- **Drag-and-drop** simplified to the browser `FileReader` (works in WebKitGTK/WKWebView).
- **`Ctrl+O` fires once** — fixed the Tauri quirk where `emit_to(WebviewWindow)` broadcasts to
  all windows, by guarding with `isFocused()`.
- **Type column widened** 70→95px so "STYLESHEET" doesn't clip.

## What's NOT ported (the gap list)

Ordered roughly by how load-bearing it is. Every one of these is described as "how it works
today" in [`01-design-philosophy.md`](01-design-philosophy.md); the Tauri build simply doesn't
have it yet.

1. **Auto-update — entirely absent.** This is the biggest gap by far. There is no
   `tauri-plugin-updater`, and everything built around updating is gone with it: the
   Install/Remind/Skip prompt, `preferences.json` persistence of skipped/remind-later state,
   the dock/taskbar download progress bar, restore-open-files-after-update, and the About-panel
   update status. The Tauri app currently has *no* update path at all.

2. **Right-click context menu — stubbed.** `platform.showRequestContextMenu()` is a no-op
   marked "Phase 2." All the copy formatters exist and are pure TS (could run in the webview
   or via a native Tauri menu), but Open-in-Browser / Copy-as-X / Copy-All-Listed / Sort-By is
   not wired. `onContextMenuSort` has a listener but nothing emits it.

3. **macOS file association (`open-file`) — not wired.** Only `argv[1]` is handled
   (Linux/Windows). Double-clicking a `.har` in Finder, or dropping it on the dock, won't open
   it in the Tauri build yet. `platform.onHarFileOpened` is a "Phase 2" `listen()` stub waiting
   for Rust to emit `har-file-opened`.

4. **Single-instance — absent.** No `tauri-plugin-single-instance`. On Windows/Linux a second
   `.har` double-click will spawn a second process instead of routing into the running one,
   which also breaks cross-launch dedup/reuse/cascade.

5. **Recent files / Open Recent menu — absent.** No Rust equivalent of the `recentDocuments`
   array or the OS recent-documents integration.

6. **macOS represented filename / proxy icon — absent.** `setWindowTitle` sets the title but
   not `setRepresentedFilename`.

7. **Welcome-window reuse for OS-driven opens — absent.** The dialog path handles it in the
   frontend (`App.tsx` loads in place when the window is empty), but `open_file_in_new_window`
   in Rust always creates a new window when not deduped — it never reuses a focused empty
   window. Mostly moot until file associations (#3) land, then it matters.

8. **Native OS theme-change push — not wired.** No `theme-changed` equivalent. System mode
   still works through the CSS `prefers-color-scheme` media query, so this is the least
   functionally urgent, but the explicit native path is gone.

9. **Tauri build & release pipeline — doesn't exist.** The CI / `release.yml` / `nightly.yml`
   workflows still build **Electron** with electron-builder. `vite.config.ts` still runs
   `vite-plugin-electron` even under a Tauri build. `package.json` still declares `electron`
   and `electron-updater`. There is no way to produce a shippable Tauri artifact yet — it runs
   in dev only.

10. **E2E tests — Electron-only.** The Playwright suite launches the Electron app. Nothing
    exercises the Tauri build. (The Vitest unit tests are runtime-agnostic and still pass.)

## Rough size of what's left

The renderer is done (shared). The remaining work is all shell + packaging: the updater, the
context menu, macOS file association, single-instance, recent files, proxy icon, then the
Tauri build/release pipeline and removing Electron. It's a well-bounded list — "finish the
port," not "figure out the port." The one genuinely fiddly item you already have in flight
(Wayland positioning) is the kind of thing worth deciding how much to care about (see
suggestions).
