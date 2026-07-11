# My Observations & Suggestions

Written by Claude while surveying the codebase. This file is deliberately kept separate from
the philosophy doc so there's no confusion about what's **current behavior** versus **my
opinion**. Within each section I mark which is which.

A caveat on confidence: I read the code but did not run either build. Items tagged
**[inferred]** are read off the source and should be reproduced at runtime before you trust
them; items tagged **[verified-in-source]** are plainly visible in the code; items tagged
**[idea]** are my suggestions, not facts about the app.

---

## A. Documentation & metadata drift (facts to fix)

These are places where the repo contradicts itself. None change behavior, but a rewrite
should reconcile them so the docs describe the shipped app.

- **`docs/development.md` is stale** [verified-in-source]. It still says "Electron 28, React
  18, TypeScript 5" and describes silent auto-update. The app is on Electron 41 / React 19 /
  TS 6 (commit `16fd5cf`) and switched to a *prompted* update flow (commit `1c2c61c`).
- **`docs/architecture.md` is stale** [verified-in-source]. It says auto-update "downloads the
  update silently, and installs it on next app quit" (no longer true), lists the preload API
  as 5 methods (it's now 9: adds `readHarFile`, `getPathForFile`, `setThemeMode`,
  `signalReady`, `showRequestContextMenu`, `onContextMenuSort`), and describes React 18.
- **App identifier is inconsistent** [verified-in-source]. `AGENTS.md` says the app ID is
  `com.netscope.app`; the actual `build.appId` in `package.json` and the Tauri `identifier`
  are both `dev.unremarkable.netscope` (renamed in the Tauri work). Pick one canonical ID.
- **Welcome-screen name in the screenshot** [verified-in-source]. `images/welcome.png` shows
  "HAR Explorer"; the code (`WelcomeScreen.tsx`) says "Netscope." The screenshot is a build
  behind. Regenerate marketing screenshots after the redesign anyway.

---

## B. Likely bugs / rough edges (observed, verify at runtime)

### Cascade anchor differs between the two branches (a decision, not just a bug)
[verified-in-source] Electron cascades new windows from the **most-recently-created** window
(`main.ts` `getCascadePosition`, commit `d5aa5c9`). The Tauri rewrite deliberately switched to
cascading from the **focused** window (`lib.rs` `cascade_position`, citing Ghostty/Chrome).
These are different behaviors. Someone should choose on purpose rather than let the port
silently change it. **[idea]** I'd keep the Tauri choice (focused-window anchor) — it matches
what Chrome and terminal apps do and is the less surprising rule.

### Possible double-fire of `Cmd+N` / `Cmd+W` on Tauri
[inferred] The `Ctrl+O` fix (commit `d5e7ca2`) removed the web-layer keydown handler for `O`
because the native menu accelerator already fires it, and having both caused a double-open.
But `App.tsx`'s global keydown handler *still* handles `Cmd/Ctrl+N` (→ `platform.newWindow()`)
and `Cmd/Ctrl+W` (→ `platform.closeWindow()`), and the Tauri native menu *also* registers
`New Window` on `CmdOrCtrl+N` (and Close on `CmdOrCtrl+W`). That looks like the same
double-trigger pattern the `O` fix addressed — on Tauri, `Cmd+N` may open two windows. Worth
reproducing and, if confirmed, consolidating to one source of truth for accelerators.

### Drag-and-drop loses the file path (so it can't dedup) in the Tauri path
[verified-in-source] `App.tsx` `handleDrop` reads the dropped file with a browser `FileReader`
and uses `file.name` — it never gets the real filesystem path, and never calls
`registerOpenFile`. In Electron the drop path historically used
`webUtils.getPathForFile()`. In the Tauri build a dropped file therefore can't be deduped
against an already-open window or tracked for "restore after update," and always just replaces
the current window's content. Tauri exposes real paths on its drag-drop event
(`getCurrent().onDragDropEvent`) — worth using instead of `FileReader` so dropped files behave
like every other open path.

### `filteredEntries` / `sortedEntries` recompute every render
[verified-in-source] In `App.tsx`, `filterTokens` and `suggestionData` are memoized, but the
`filteredEntries` filter and the `sortedEntries` sort run on every render (including
selection changes, detail-panel toggles, theme changes). On a large HAR that's a full
filter+sort of thousands of entries per keystroke elsewhere in the UI. Low-risk to wrap in
`useMemo` keyed on `[har, filter, sort, filterTokens]`.

### `vite.config.ts` builds Electron even under Tauri
[verified-in-source] The Vite config unconditionally runs `vite-plugin-electron` (bundling
`electron/main.ts` + `preload.ts`) regardless of target, and `tauri.conf.json`'s build command
is `npm run build:vite`. During the migration this means Tauri builds also bundle the Electron
main process. Needs to be conditional (or removed once Electron is dropped).

### Startup file existence check is extension-gated
[verified-in-source, minor] Both the Electron `second-instance`/argv handling and the Tauri
`argv[1]` path only accept files ending in `.har`. Opening a HAR with a non-`.har` extension
from the CLI/OS is silently ignored. Probably intended, but flagging since the Open dialog
allows "All Files."

---

## C. My improvement ideas (opinions — not current behavior)

All **[idea]**. Take or leave; none describe how the app works today.

- **Don't let Wayland cascade perfection block the release.** The stalled work is
  pixel-accurate window cascading on Wayland, where the compositor owns placement anyway. Ship
  a good-enough default (offset when the platform cooperates, let the compositor decide when it
  doesn't) and move on. It's the lowest-ROI corner of the whole project and it's what stopped
  momentum last time.

- **Export the filtered subset as a new `.har`.** A read-only inspector that lets you *narrow*
  to the requests you care about and *save that view* as a smaller HAR is a natural, low-risk
  feature that fits the "reproduce/share this" workflow already served by copy-as-cURL. It
  stays local-first and doesn't turn the app into an HTTP client.

- **Parse large HARs off the main thread.** Parsing happens synchronously in the renderer
  today. For multi-MB captures, a Web Worker (or Rust-side parse returning structured data)
  would keep the window responsive and remove the need for the 800ms "show anyway" fallback.

- **Show recent files on the welcome screen.** The OS Recent Documents menu is a bit hidden.
  An in-window recent-files list on the welcome screen would make reopening captures faster and
  gives the empty state a reason to exist beyond one button.

- **Persist window size/position across launches.** Proper document apps remember where you put
  their windows. Cheap to add in Tauri and a nice touch for a tool people keep open.

- **Consolidate keyboard shortcuts to one source of truth.** Right now accelerators live in two
  places (native menu definitions and the `App.tsx` keydown handler), which is exactly what
  produced the `Ctrl+O` double-fire. A single declarative shortcut map that both the menu and
  the web layer read from would prevent the whole class of bug.

- **Diff two HARs.** Bigger and probably a separate release, but comparing two captures
  (before/after a change, prod vs. staging) is the single most-requested thing I'd expect from
  a HAR tool that isn't DevTools. Noting it for the roadmap, not this rewrite.

- **Settle the app identity once.** `dev.unremarkable.netscope` appears to be the intended
  new bundle ID. Make it canonical across `package.json`, `tauri.conf.json`, `AGENTS.md`, and
  the docs so signing/notarization/update channels all agree.
