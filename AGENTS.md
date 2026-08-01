# AGENTS.md

## Project Overview

**Netscope** is a native, local-first desktop app for viewing and analyzing HTTP Archive (HAR) files, available for macOS, Windows, and Linux. It provides a Chrome DevTools-like network inspection experience as a standalone document app. Built with Tauri 2 (Rust shell), React 19, TypeScript, and Vite.

- **Package name:** `netscope`
- **App ID:** `dev.unremarkable.netscope`
- **Repository:** https://github.com/Dru89/netscope
- **License:** MIT

Two commitments shape everything: it's **local-first** (HAR files carry cookies and auth tokens; nothing is ever uploaded — the only network request is the update check), and it's a **document app** (one window per file, file associations, recent documents, macOS proxy icon — not a single-window SPA).

## Architecture

Netscope has two layers:

1. **Rust shell** (`src-tauri/src/`) — window management, file I/O, native menus, file associations, single-instance, recent files, the auto-updater, and the request-row context menu. Modules:
   - `lib.rs` — plugin setup, `#[tauri::command]` definitions, startup (CLI arg / restore-after-update), `RunEvent` handling (macOS `Opened`/`Reopen`/`ExitRequested`)
   - `windows.rs` — window creation (cascade positioning with Wayland-safe tracking, hidden-until-ready), dedup (`open_files` map), welcome-window reuse, `open_file_from_path` (the unified entry for OS-driven opens), error dialogs
   - `menu.rs` — the full native menu (File/Edit/View/Window/Help + macOS app menu), rebuilt when recent files or update state change
   - `context_menu.rs` — the native request-row context menu; copy actions round-trip to the webview, which runs the TS copy formatters and calls `set_clipboard`
   - `recent.rs` — Open Recent list, persisted in `preferences.json` and mirrored to the OS recent-documents list (NSDocumentController / SHAddToRecentDocs / GTK RecentManager)
   - `update.rs` — prompted update flow (Install / Remind Me Later / Skip This Version), download progress on the taskbar, restore-open-files across the update restart, About-panel status
   - `prefs.rs` — `preferences.json` in the app-data dir
   - `state.rs` — `AppState` (window/file maps, cascade positions, zoom levels, recent list, pending update)

2. **Renderer** (`src/`) — a React SPA bundled by Vite. All state lives in `App.tsx` (no external state library). Native access goes exclusively through `src/platform.ts` — no other file may import `@tauri-apps/*`. Every `platform.ts` function no-ops in plain-browser dev, where `npx vite` + `?fixture=/test/fixtures/x.har` loads a file over HTTP.

IPC: `#[tauri::command]` invocations renderer→Rust; events (`har-file-opened`, `request-open-file`, `context-menu-action`, `context-menu-sort`) Rust→renderer. **Gotcha:** `emit_to` broadcasts to every window, so targeted events carry a `targetLabel` the renderer filters on (or an `isFocused()` guard for `request-open-file`).

Detailed docs are in `docs/architecture.md`.

## Directory Structure

```
src-tauri/          Rust shell (see modules above)
  capabilities/     Webview permission grants (keep minimal)
  icons/            Bundler icons (regenerate with make icons)
  netscope.desktop  Linux desktop-entry template (adds %F + MimeType)
  tauri.conf.json   App config; version reads from package.json
src/
  components/       React components (WelcomeScreen, Toolbar, FilterInput, RequestTable, DetailPanel, SummaryBar)
  platform.ts       The renderer↔shell seam (all native access)
  styles/           tokens.css (design tokens — source of truth), global.css, app.css
  types/            HAR spec types
  utils/            HAR parsing, filtering, suggestions, copy formatters, JSON highlighting — pure functions with tests
  App.tsx           Root component — all application state lives here
scripts/
  build-pacman.sh   Wraps the .deb into an Arch pacman package (CI)
test/
  e2e/              WebDriver E2E via tauri-driver (Linux; see helpers.ts)
  fixtures/         HAR captures (Git LFS)
docs/               Internal docs
site/               Marketing website (Astro, Netlify)
handoff/            Electron→Tauri migration briefs and the design handoff (historical)
```

**Build outputs (git-ignored):** `dist/` (Vite), `src-tauri/target/` (Rust + bundles under `target/release/bundle/`).

## Code Conventions

- **Components:** Named function exports in PascalCase files; props interfaces inline; sub-components may be co-located. `Toolbar`/`FilterInput` accept a `ref` for external focus control.
- **Types:** HAR spec types prefixed `Har`; app types unprefixed; computed fields prefixed `_`.
- **Styling:** Plain CSS, BEM-ish class names. **Every color must be a `--ns-*` token** from `src/styles/tokens.css` (the "Instrument" design system — light/dark/system via `data-theme` on `<html>`; System mode = attribute absent, `prefers-color-scheme` decides). No CSS frameworks, no color literals in component styles.
- **State:** All state in `App.tsx` via hooks, passed as props. `filteredEntries`/`sortedEntries` are memoized — keep them that way; large HARs re-filter on every keystroke otherwise.
- **Pure utilities:** parsing/filtering/formatting live in `src/utils/` as pure functions with Vitest tests next to them.
- **Rust:** platform-specific code behind `#[cfg(target_os = ...)]`; macOS AppKit calls hop to the main thread via `run_on_main_thread`.
- **No default exports** except `App.tsx`.

## Key Commands

```bash
make dev              # Vite dev server + Tauri shell with hot reload
make build            # tsc && vite build (renderer bundle only)
make package          # Full production build: tauri build (bundles for this platform)
make test             # Vitest unit tests + cargo test
make test-watch       # Renderer tests in watch mode
make test-e2e         # Build binary + WebDriver E2E (Linux; needs tauri-driver + WebKitWebDriver)
make lint             # Type-check only (tsc --noEmit)
make clean            # Remove dist/ and bundle outputs
make icons            # Regenerate all icons from images/netscope.png (tauri icon)
make release          # Interactive version bump, tag, push (CI builds the release)
make site-dev         # Astro dev server for the marketing site
make site-build       # Build the marketing site
```

Production builds with the updater enabled need `TAURI_SIGNING_PRIVATE_KEY` (+`_PASSWORD`) in the environment; CI has them as secrets. The Tauri CLI has no dotenv support, so `make package` is what loads `.env` — a bare `npx tauri build` reads nothing from it. Local variable names differ from the GitHub secret names for the Apple credentials (`APPLE_PASSWORD` vs `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_CERTIFICATE*` vs `MAC_CERTIFICATE_*`); see `.env.example`.

For a local test build without the key, use `npx tauri build --no-sign --bundles app`. `--no-bundle` produces no `.app` and is only for the bare binary (CI and `make test-e2e`). See `docs/development.md`.

## Testing

Unit tests use **Vitest**; test files sit next to sources (`.test.ts`).

```
src/utils/filterParser.test.ts       # Filter parser and matcher
src/utils/filterSuggestions.test.ts  # Autocomplete suggestions
src/utils/copyFormatters.test.ts     # Copy-as-cURL/fetch/PowerShell
src/utils/har.test.ts                # Transfer-size handling (Chrome _transferSize)
src/utils/highlightJson.test.ts      # Response-tab JSON syntax tint
src/App.test.tsx                     # Component tests (jsdom)
src/components/DetailPanel.test.tsx  # Component tests (jsdom)
src/components/SourceTab.test.tsx    # Component tests (jsdom)
src-tauri/src/lib.rs                 # argv parsing + mock-runtime command tests
src-tauri/src/state.rs               # #[cfg(test)] pending-picker claim
src-tauri/src/update.rs              # #[cfg(test)] date math for remind-later
```

### Rust mock-runtime tests

`tauri::test` (a dev-only feature in `Cargo.toml`) builds an app on `MockRuntime` with no webview and no display, so window-scoped commands can be driven **on macOS**, where tauri-driver can't run at all:

```rust
let app = mock_builder()
    .manage(AppState::new())
    .build(mock_context(noop_assets()))
    .unwrap();
let win = WebviewWindowBuilder::new(&app, "window-1", WebviewUrl::App("index.html".into()))
    .build()
    .unwrap();
```

- A command must be generic over the runtime to be callable this way — `fn get_window_file<R: tauri::Runtime>(window: WebviewWindow<R>)`. Everything in `windows.rs` is still hard-typed to `Wry` and can't be reached yet.
- `noop_assets()` keeps the tests independent of whether the renderer has been built. Don't reach for `generate_context!()` — besides needing `dist/`, it carries the real identifier, which points the next item at the developer's actual preferences file.
- **`note_file_open` is not safely testable as written.** It fans out into `recent::add`, which persists `preferences.json`, mirrors to the OS recent-documents list (objc2 on the main thread), and rebuilds the menu. Those seams need injecting first. See #13.

Run `npm test` (and `cargo test --manifest-path src-tauri/Cargo.toml`) before committing. New utility functions need tests.

### Component tests

Utility tests run in node. Component tests opt into jsdom with a docblock on the first line of the file:

```tsx
// @vitest-environment jsdom
```

They mock the native boundary wholesale, which works only because `platform.ts` is the sole module allowed to import `@tauri-apps/*`:

```tsx
vi.mock("./platform", async () => {
  const { platformMock } = await import("./testing/platformMock");
  return platformMock();
});
```

- `src/testing/platformMock.ts` — a `vi.fn()` per `platform.ts` export. **Add to it when you add a platform function**, or the component fails with "not a function". Listener registrars must return a cleanup function.
- `src/testing/har.ts` — `makeHar()` builds synthetic captures. Keep them under 12 entries: jsdom measures the viewport as zero, so the virtual window falls back to `MIN_OVERSCAN` and renders only the first 12 rows.
- `src/testing/setup.ts` — stubs `ResizeObserver` and `matchMedia`, which jsdom lacks. Runs for every test file and stays inert in node.
- Register `afterEach(cleanup)` yourself; vitest globals are off, so testing-library's auto-cleanup doesn't fire.

This layer catches renderer wiring bugs that fall between the unit tests and E2E — native menus can't be driven over WebDriver, and tauri-driver doesn't run on macOS at all. See #13.

### E2E Tests

`test/e2e/` drives the real release binary through **tauri-driver** (WebDriver → WebKitWebDriver) with webdriverio + Vitest: welcome screen, CLI-arg file open, filtering, detail panel, sorting, keyboard nav.

- Linux only: tauri-driver has no macOS support; Windows needs msedgedriver wiring (future work). Arch doesn't ship WebKitWebDriver, so on Arch dev machines E2E is CI-only.
- CI runs it under `xvfb-run` in the `e2e` job (`.github/workflows/ci.yml`).
- Native menus and dialogs can't be driven over WebDriver; the context menu is covered indirectly by the copy-formatter unit tests and the macOS QA checklist (`docs/macos-qa-checklist.md`).

## Keyboard Shortcuts

### Table-scoped (when request table has focus)

| Shortcut       | Action                                 |
| -------------- | -------------------------------------- |
| Up / k         | Select previous entry                  |
| Down / j       | Select next entry                      |
| Cmd+Up / Home  | Select first entry                     |
| Cmd+Down / End | Select last entry                      |
| Enter / Space  | Toggle detail panel for selected entry |

### Global

| Shortcut                      | Action                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Cmd+N                         | Open a new empty window (native menu)                                            |
| Cmd+O                         | Open file — loads in place on welcome screen, opens new window if file is loaded |
| Cmd+W                         | Close window (native menu)                                                       |
| Cmd+R / Cmd+0 / Cmd+= / Cmd+- | Reload / reset zoom / zoom in / zoom out (View menu)                             |
| Escape                        | Close detail panel and return focus to table; blur filter input                  |
| /                             | Focus the toolbar filter input                                                   |
| Cmd+F                         | Focus the toolbar filter (unless focus is in the detail panel)                   |

**Accelerator ownership:** window-level shortcuts (Cmd+N/O/W/R, zoom) belong to the **native menu only** — do not add web-layer keydown handlers for them; both firing was the source of the double-open bugs. Content shortcuts (/, Cmd+F, Escape, table nav) live in the web layer.

**Focus model:** the table container has `tabIndex={0}` and handles its own keys. Focus in the detail panel or filter input disables table shortcuts by design. Escape unwinds in a ladder: Source-tab search → detail panel → table focus.

## Context Menu

Right-clicking a request row shows a **native** context menu built in Rust (`context_menu.rs`) and popped at the cursor. Only the URL and sort state cross IPC when it opens; entry data stays in the webview. Menu actions emit `context-menu-action` back to the originating window, which runs the pure copy formatters (`src/utils/copyFormatters.ts`) and writes the clipboard via the `set_clipboard` command.

| Item                                                                                 | Action                                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Open in Browser                                                                      | Opens the URL via the opener plugin                            |
| Copy > Copy URL / as cURL / as fetch / as fetch (Node.js) / as PowerShell / Response | Single-entry copy variants                                     |
| Copy > Copy All Listed ...                                                           | Bulk variants over the currently filtered set                  |
| Sort By > ...                                                                        | Changes sort; checked item shows the current field + direction |

## Multi-Window Behavior

Each HAR opens in its own OS window. New windows cascade 28px down-right from the **focused** window (Ghostty/Chrome behavior — deliberate change from the Electron app, which anchored on most-recently-created). Cascade positions are tracked in an explicit map because `outer_position()` fails on Wayland.

### Opening files

Every open path funnels through dedup: opening an already-open file focuses its window. Entry points: Open dialog (multi-select: first file in place, rest in new windows), Open Recent, drag-drop (native paths via `onDragDropEvent`), CLI args, second launches (single-instance handoff on Windows/Linux), and macOS `open-file` events. OS-driven opens reuse a **focused** empty welcome window (or the sole empty window at launch); an unfocused welcome window is never silently taken over.

Windows are created hidden and shown when the renderer signals ready (`signal_ready`), with an 800ms timeout — no welcome-screen flash, no white flash in dark mode.

### Recent files

File > Open Recent is capped at 10, persisted in `preferences.json` (an improvement over Electron's in-memory list), and mirrored to the OS recent-documents list. Missing files show a native warning and are pruned.

### Quit behavior

Windows/Linux: the app exits when the last window closes (Tauri default). macOS: `ExitRequested` is prevented, and dock-click (`Reopen`) creates a new welcome window.

## Filter Syntax

The toolbar input supports DevTools-style structured filters (`src/utils/filterParser.ts`):

| Filter                 | Example                        | Matches                             |
| ---------------------- | ------------------------------ | ----------------------------------- |
| (plain text)           | `api`                          | URL or entry name substring         |
| `domain:`              | `domain:*.example.com`         | Request domain (wildcard supported) |
| `method:`              | `method:POST`                  | HTTP method                         |
| `status-code:`         | `status-code:4xx`              | Status code (exact or `4xx` range)  |
| `mime-type:`           | `mime-type:json`               | Response MIME type substring        |
| `larger-than:`         | `larger-than:1k`               | Transfer size threshold (`k`, `M`)  |
| `scheme:`              | `scheme:https`                 | URL scheme                          |
| `has-response-header:` | `has-response-header:x-custom` | Presence of a response header       |
| `url:`                 | `url:/api/v2`                  | URL substring (explicit)            |

Tokens AND-combine; `-` negates; quoted values allowed. Toolbar content-type chips are a second filter layer AND-ed with the text query. Autocomplete (`filterSuggestions.ts`) offers keys and real values from the loaded file. Default sort is Waterfall ascending (chronological).

## Auto-Update

`tauri-plugin-updater` with a **prompted** flow (`update.rs`): Install Update / Remind Me Later (persisted for the UTC calendar day) / Skip This Version (persisted until a newer version), stored in `preferences.json`. Download progress shows on the dock/taskbar; failures get a dialog; the About panel shows "version X is ready — restart to install"; open files are restored after the update restart.

Channels: stable reads `releases/latest/download/latest.json`; nightly builds are pointed (via `--config` at build time) at a rolling `nightly` release manifest that the nightly workflow refreshes. Linux self-update only works for the AppImage; deb/pacman installs update through the package manager.

Updater artifacts are signed with a minisign key (`plugins.updater.pubkey` in `tauri.conf.json`); CI signs with `TAURI_SIGNING_PRIVATE_KEY`. **If that key is lost, shipped apps can never update again** — it's backed up in Drew's password manager.

## Architecture Decisions / Patterns to Preserve

- **Local-first, always.** No network calls except the update check. Never transmit HAR contents.
- **No external state library.** All state in `App.tsx`.
- **No row virtualization.** All rows are real DOM. Measured: 10k entries render and stay responsive for selection (memoized filtering); a filter keystroke on 10k entries costs ~500ms. Revisit only if real captures hurt — virtualization complicates keyboard nav and scroll-into-view.
- **No CSS framework.** Tokens + vanilla CSS.
- **Pure utilities, thin components.**
- **Read-only tool.** No editing, no request replay, no collections. Copy-as-X is the reproduce workflow.
- **platform.ts is the only native seam.** Keep it that way; it's what keeps the renderer testable in a browser.

## Release Process

Releases are tag-driven (`v*`) and built by `.github/workflows/release.yml` on a macOS/Windows/Linux matrix using `tauri-action`.

1. `make release` (or `make release VERSION=<patch|minor|major|x.y.z>`) — bumps `package.json` (the single version source; `tauri.conf.json` reads it), commits, tags, pushes.
2. CI builds: signed + notarized macOS universal dmg/app (with a codesign verification step), Windows NSIS (unsigned — accepted SmartScreen tradeoff), Linux AppImage + deb + a pacman package wrapped from the deb (`scripts/build-pacman.sh`; Arch lacks FUSE 2 for AppImages).
3. `latest.json` (updater manifest) is merged across platforms onto the release.

Nightly (`nightly.yml`): daily cron + pushes to `nightly` + manual dispatch → dated pre-releases (`vX.Y.Z-nightly.YYYYMMDD`), manifest copied to the rolling `nightly` release.

### Required GitHub Actions secrets

| Secret                               | Purpose                                      |
| ------------------------------------ | -------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Updater artifact signing (minisign)          |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the key — set, but empty        |
| `MAC_CERTIFICATE_BASE64`             | Base64-encoded .p12 Developer ID certificate |
| `MAC_CERTIFICATE_PASSWORD`           | Password for the .p12                        |
| `APPLE_ID`                           | Apple ID email for notarization              |
| `APPLE_APP_SPECIFIC_PASSWORD`        | App-specific password for notarization       |
| `APPLE_TEAM_ID`                      | Apple Developer Team ID                      |

**Do not bump the version as part of code-change commits.** `make release` owns version bumps; code and version changes stay separate in history.

## App Icon

Source: `images/netscope.png` (2048×2048). `make icons` regenerates everything in `src-tauri/icons/` via `tauri icon`. Site favicons in `site/public/` are derived from the same source.

macOS document icons: the `.har` UTI is declared **without** any icon reference so macOS generates the native page-curl document icon — see `docs/macos-document-icons.md` before touching `fileAssociations` or Info.plist icon keys.

## Important Notes

- Builds target macOS 12+ (universal), Windows 10+ (x64, NSIS), Linux x64 (AppImage/deb/pacman).
- `dist/` must exist before `cargo` commands that touch `tauri::generate_context!` (run `npm run build:vite` first).
- The webview capability set (`src-tauri/capabilities/default.json`) is deliberately minimal; file reads go through the `read_har_file` command rather than fs-plugin scopes, because drops/recent files/CLI args hand the app arbitrary paths.
- On NVIDIA + Wayland, WebKitGTK's DMA-BUF renderer is disabled at startup (`lib.rs`) to avoid a crash; don't remove that guard without testing on that stack.
- The marketing site (`site/`) deploys to Netlify via `netlify.toml`.

## Keeping This File Up to Date

When you change the project, update this file: new commands → Key Commands; new shortcuts → Keyboard Shortcuts; new filters → Filter Syntax; new tests → Testing; architecture changes → Architecture; new directories → Directory Structure. Update `docs/` when features change (especially `docs/features.md` and `docs/architecture.md`).
