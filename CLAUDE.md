# CLAUDE.md

This repo's primary engineering doc is **[AGENTS.md](AGENTS.md)** — architecture, code
conventions, key commands, testing, keyboard shortcuts, filter syntax, multi-window behavior,
context menus, and the release/auto-update process. Read it before making changes, and keep it
current when you change the project (it has a "Keeping This File Up to Date" section).

## Active work: Electron → Tauri migration

Netscope is mid-migration from Electron (the shipping app, on `main`) to Tauri (in progress,
on `nightly` and rewrite branches). The migration briefs and the visual redesign live in
**[handoff/](handoff/)**:

- `handoff/04-fable5-rewrite-brief.md` — the rewrite brief; **start here for migration work.**
- `handoff/01-design-philosophy.md` — how the app is meant to behave (shell, windowing, updates).
- `handoff/02-tauri-migration-status.md` — what's ported to Tauri and what's left.
- `handoff/05-my-observations-and-suggestions.md` — known bugs, doc drift, and improvement ideas.
- `handoff/claude design handoff/` — the "Instrument" visual redesign: `netscope-tokens.css`
  (token set) and `REDESIGN.md` (component spec) are the source of truth; the mockup is a
  visual reference.

`main` is the behavioral reference for parity. When the Tauri migration reaches parity and
Electron is removed, update AGENTS.md and `docs/` to describe the Tauri app, and prune whatever
here is no longer relevant.
