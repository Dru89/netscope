# Netscope Handoff Pack

Prepared to feed two downstream efforts: a **UI redesign by Claude Design** and a **full
refactor/rewrite by Fable 5**. Everything here was reconstructed from the shipping Electron app
on `main`, the abandoned Tauri migration on `nightly`, the git history, and the screenshots in
`../images/`.

## The two primary deliverables

- **[03-claude-design-brief.md](03-claude-design-brief.md)** → give this to **Claude Design**.
  A visual/component redesign brief. Pair it with the screenshots listed inside it
  (they're good input — clean, current except one stale label, and cover every surface).

- **[04-fable5-rewrite-brief.md](04-fable5-rewrite-brief.md)** → give this to **Fable 5**.
  A full refactor/rewrite brief targeting Tauri, with bug-fix / perf / general-improvement
  latitude. **It contains the decision you asked for:** continue the abandoned Tauri migration
  and finish it (don't start over), then delete Electron once at parity — with reasoning.

## Supporting documents (shared inputs to both)

- **[01-design-philosophy.md](01-design-philosophy.md)** — the articulated philosophy: shell &
  windowing, interaction/functionality, and release/auto-update, all described as *how the app
  works today*. This is the behavioral contract for the rewrite and background for the redesign.

- **[02-tauri-migration-status.md](02-tauri-migration-status.md)** — how far the Tauri port got,
  what's still missing (the gap list), and the signal for where you actually stopped (mid-fight
  with Wayland window positioning).

- **[05-my-observations-and-suggestions.md](05-my-observations-and-suggestions.md)** — my own
  findings: doc/metadata drift, likely bugs to verify, and improvement ideas. Facts and
  opinions are tagged separately so it's always clear which is which.

## The headline answers

**How far did the Tauri migration get?** The renderer (React UI, HAR parser, filter engine,
copy formatters, tests) is fully portable and already shared. The Rust shell has window
creation, cascade positioning, file dedup, the pending-file handoff, quit-on-last-window,
native menus, and CLI-arg file opening. **Still missing:** auto-updater (the biggest gap), the
request-row context menu, macOS file association, single-instance, recent files, the macOS
proxy icon, and the entire Tauri build/release pipeline (CI still builds Electron). It stalled
on Wayland window-position handling — the last change on the branch is uncommitted.

**Continue or start over (for Fable 5)?** Continue. The portable half is done and tested, the
hard shell logic is already translated and encodes real product decisions, and what remains is
bounded finishing work with `main` as an exact reference. Full reasoning in the Fable 5 brief.

**Are the screenshots good input for Claude Design?** Yes — include them. They're
high-resolution and cover welcome, main (light + dark), filter, search, and the detail-panel
Headers / Timing / Source tabs. Only caveat: the welcome shot reads "HAR Explorer"; the product
name is "Netscope." Details in the design brief.
