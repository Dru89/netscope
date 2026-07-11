# Brief for Fable 5 — Refactor / Rewrite Netscope on Tauri

## The job

Netscope is a native, local-first HAR-file viewer (DevTools Network panel as a standalone
desktop app) for macOS, Windows, and Linux. It ships today as an Electron app on `main`. I
want you to deliver it as a **finished Tauri app** — and while you're in there, act as a
senior engineer doing a real refactor: fix bugs, improve performance, tighten the
architecture, and make the app better wherever you see the opportunity. This is not a
transliteration exercise. It's "take ownership of this codebase and ship the version it should
be."

Read these three companion documents first — they are the spec:

- [`01-design-philosophy.md`](01-design-philosophy.md) — how the app is *meant* to work and
  why (shell, functionality, release/update). This is the behavioral contract.
- [`02-tauri-migration-status.md`](02-tauri-migration-status.md) — exactly what's already
  ported to Tauri and what isn't.
- [`05-my-observations-and-suggestions.md`](05-my-observations-and-suggestions.md) — known
  bugs, stale docs, and my own improvement ideas (clearly separated from current behavior).

And the visual redesign, delivered by Claude Design, lives in
[`claude design handoff/`](claude%20design%20handoff/). Implement it as the app's new look;
where it's silent, fall back to sensible defaults consistent with its system. See
[**Implementing the redesign**](#implementing-the-redesign) below for exactly how to consume it.

## Decision: continue the Tauri migration — do not start from scratch

I want this settled in the brief, so here it is with the reasoning.

**Continue from the `nightly` branch. Don't rebuild from a blank slate.**

Why:

1. **The renderer is already portable and done.** The entire React UI, HAR parser, filter
   engine (with a real query language), copy formatters, and their unit tests are
   platform-agnostic and shared through `src/platform.ts`. There is nothing to gain by
   rewriting that half, and real coverage to lose. A from-scratch rewrite would recreate
   working, tested code.

2. **The hard shell logic is already ported, and it encodes real decisions.** Cascade math,
   the Wayland/X11 window-position handling, file dedup, the pending-file handoff, quit-on-
   last-window — these are the non-obvious parts, already translated to Rust. They represent
   weeks of fiddly platform work and specific product choices (see the philosophy doc). Throw
   them away and you re-derive the same edge cases.

3. **What's left is well-bounded finishing work, not discovery.** The gap list in the status
   doc — updater, context menu, macOS file association, single-instance, recent files, proxy
   icon, then the Tauri build/release pipeline — is "finish the port." The shape of each piece
   is already known because `main` shows exactly how it should behave.

4. **The code quality is high enough to build on.** Careful comments, real tests, deliberate
   edge-case handling. This isn't a codebase you rewrite to escape.

**But "continue" does not mean "preserve everything."** Specifically:

- The Electron ↔ Tauri dual-runtime split (`isElectron()` branching throughout
  `src/platform.ts`, plus `electron/`, `electron-updater`, the electron-builder config, and
  the `vite-plugin-electron` setup) is **transitional scaffolding**. Once the Tauri build
  reaches parity, **delete Electron entirely** and collapse the platform seam to a single
  clean Tauri implementation. Don't ship a permanent two-runtime app.
- You have full latitude to restructure the Rust (`src-tauri/`), redesign the platform module,
  reorganize the renderer, change build tooling, and update dependencies. The `nightly` branch
  is a starting point and a source of solved problems, not a straitjacket.

If, once you're in it, you find the existing Tauri code is genuinely working against you on
some specific piece, rewrite *that piece* — but the default is continue-and-finish.

## Parity target: `main` is the source of truth

Treat the shipping Electron app on `main` as the **fully-featured, correct reference**. The
Tauri app is done when it matches `main`'s behavior across the whole surface. The concrete
checklist (all specified in the philosophy doc, all currently missing or stubbed in Tauri):

- [ ] **Auto-updater** — `tauri-plugin-updater`, with the *user-prompted* flow from `main`:
      Install / Remind Me Later (persisted for the day) / Skip This Version (persisted until a
      newer version). Plus dock/taskbar download progress, failure dialog, **restore-open-files
      after the update restart**, and About-panel update status. Match the stable + nightly
      two-channel scheme.
- [ ] **Request-row context menu** — native menu (or a well-built in-app menu if that's cleaner
      in Tauri): Open in Browser; Copy as cURL / fetch / fetch-Node / PowerShell / Response;
      Copy All Listed variants over the filtered set; Sort By with current-sort indicator.
      Reuse the existing pure copy-formatter functions.
- [ ] **macOS file association** — open `.har` via Finder double-click, dock drop, and `open
      --args`, routed through the same dedup / welcome-reuse / cascade logic as every other
      open path.
- [ ] **Single-instance** — `tauri-plugin-single-instance` on Windows/Linux; a second launch
      hands its file to the running process (matching the Electron behavior).
- [ ] **Recent files** — Open Recent menu + OS recent-documents integration, capped, with stale
      entries pruned and a warning on missing files.
- [ ] **macOS represented filename / proxy icon** on the title bar.
- [ ] **Welcome-window reuse** for OS-driven opens (focused-empty-window only — see the
      philosophy doc for the exact rule).
- [ ] **Tauri build + release pipeline** — per-platform CI matrix producing signed macOS
      (Developer ID + notarization), Windows, and Linux (AppImage / deb / **pacman** — Arch
      lacks FUSE 2) artifacts, stable + nightly channels, feeding the updater. Then remove the
      Electron build entirely.
- [ ] **E2E coverage** for the Tauri build to replace the Electron Playwright suite.

## Where the previous attempt stopped

The last uncommitted change on `nightly` is Wayland window-position handling in
`src-tauri/src/lib.rs` — that's the tar pit that stalled the migration. Decide deliberately how
much to invest there (my take is in the suggestions doc: don't let pixel-perfect Linux cascade
block the release; a good-enough default is fine).

## Implementing the redesign

The design lives in [`claude design handoff/`](claude%20design%20handoff/):

- **`netscope-tokens.css`** and **`REDESIGN.md`** are the **source of truth.** The tokens file
  is a complete, portable custom-property set (light / dark / system, with the no-flash
  pattern already handled); `REDESIGN.md` is the per-component spec ("Instrument" direction).
  Everything else is reference.
- **`mockup/Netscope Directions.dc.html`** is the visual reference — Turn 2 shows every surface
  in the chosen direction, Turn 3 the Response tab, Turn 1 the three explored directions. It's a
  Claude "design compositions" file that needs `mockup/support.js` and (for its own doc chrome)
  Google Fonts to render fully. **Read it as a picture of the target, not as code to lift.**

Integration notes — these are the seams between the design and the current app, so wire them
deliberately:

- **Adopt the new token names.** The redesign renames everything to `--ns-*`; the current app
  uses `--color-*`. Migrate to the `--ns-*` set (drop-in `netscope-tokens.css`) rather than
  leaving two token systems side by side. Every on-screen color must be a token — no literals.
- **Theme via a root `data-theme` attribute.** The tokens file expects `data-theme="light"` /
  `"dark"` on the root for explicit choices, and *no* attribute for System (it falls back to
  `prefers-color-scheme`). Wire the summary-bar theme toggle to set/remove that attribute, and
  set it before first paint for an explicit choice so there's no flash. (This can replace the
  current native `setTheme` round-trip, or complement it — your call, but `data-theme` is what
  the CSS keys off.)
- **macOS traffic-light inset.** The design uses `--ns-inset-macos: 52px`, applied only on
  macOS. You'll need a platform signal on the root in the Tauri build (the Electron preload set
  `data-platform`; Tauri needs an equivalent — set it from `@tauri-apps/plugin-os` / the OS type
  at startup).
- **Keep system fonts — do not add a webfont dependency.** The token file specifies
  `-apple-system` UI and `ui-monospace` data fonts, and the mockup's actual app surfaces use
  those. The Spline Sans / JetBrains Mono webfonts are only the design-doc's own chrome. A
  local-first offline app shouldn't fetch fonts over the network (it also complicates CSP), so
  stay on the system stacks the tokens define.
- **Behavior is out of scope for the design, not for you.** `REDESIGN.md` restyles surfaces
  only; it deliberately doesn't touch window management, filtering, shortcuts, or the update
  flow. Those still come from the parity checklist and the philosophy doc.

## Improve, don't just port — explicit invitation

Beyond parity, I want your judgment applied. In scope and encouraged:

- **Bug fixes.** Start from the known-issues list in the suggestions doc, but hunt for more.
- **Performance.** The table renders every row as real DOM with no virtualization — a
  deliberate call for typical files, but very large captures (10k+ entries) may need attention.
  Sorting/filtering recompute on every render today (`filteredEntries`/`sortedEntries` aren't
  memoized in `App.tsx`, unlike the filter tokens which are). Fair game to fix, measure it.
- **Architecture.** Clean up the platform seam post-Electron, tighten types, reduce prop
  drilling if it's gotten unwieldy — without over-engineering (see constraints).
- **Robustness.** HAR files are messy and spec-loose; harden the parser against malformed
  input and surface good errors.
- **General polish.** Anything that makes it a better tool. Use your judgment.

## Constraints — the deliberate non-goals to respect

These are intentional and documented in the codebase. Keep them as defaults; override only
with a stated reason:

- **Local-first, always.** No network calls except the update check. Never transmit HAR
  contents anywhere. This is the app's core promise.
- **No external state library** unless the app genuinely outgrows `App.tsx` state.
- **No CSS framework.** Plain CSS + custom properties is the styling model (and the design
  hand-off is built for that).
- **Pure, tested utilities; thin components.** Keep parsing/filtering/formatting as pure
  functions with unit tests.
- **Read-only tool.** No editing, no in-app request replay, no collections. Copy-as-X is the
  reproduce-request workflow.
- **Stay narrow.** Resist scope creep into a general API client.

## Definition of done

A single-runtime Tauri app that (1) matches `main`'s full behavior across the parity checklist,
(2) implements the new design, (3) builds and auto-updates on all three platforms via CI in
both channels, (4) has Electron fully removed, (5) carries forward the unit tests and has Tauri
E2E coverage, and (6) is measurably at least as fast as the Electron build on a large HAR.
Along the way, fix the known bugs and any others you find, and leave the docs
(`AGENTS.md`, `docs/`, `README.md`) accurate to the shipped Tauri app.
