# CLAUDE.md

This repo's primary engineering doc is **[AGENTS.md](AGENTS.md)** — architecture, code
conventions, key commands, testing, keyboard shortcuts, filter syntax, multi-window behavior,
context menus, and the release/auto-update process. Read it before making changes, and keep it
current when you change the project (it has a "Keeping This File Up to Date" section).

Netscope is a Tauri 2 app (Rust shell in `src-tauri/`, React renderer in `src/`). The
2026 Electron → Tauri migration is complete; the briefs and the "Instrument" visual-redesign
handoff that drove it are preserved in **[handoff/](handoff/)** for historical context —
`handoff/claude design handoff/REDESIGN.md` and `netscope-tokens.css` remain the reference
for the design system now living in `src/styles/tokens.css`.

macOS-specific behaviors can't be exercised by the Linux E2E suite; before touching window
management, file handling, menus, or the updater, read `docs/macos-qa-checklist.md`.
