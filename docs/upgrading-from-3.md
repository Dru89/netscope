# Upgrading from Netscope 3

Netscope 4 is a rewrite: the Electron shell was replaced with Tauri. Most of
that is invisible, but the app's bundle identifier changed with it, from
`com.netscope.app` to `dev.unremarkable.netscope`, and the operating system
treats a new identifier as a new application.

This is a one-time break at the 3 → 4 boundary. Updates within 4.x behave
normally.

## How the update reaches you

Netscope 3.4.x doesn't update itself into 4.x. The two use different updaters
and different artifact formats, so 3.4.x instead notices that a 4.x release
exists and walks you through downloading the installer once. After that,
Netscope 4's own updater takes over.

If you're on 3.3.x or earlier, update to 3.4.x first — it exists only to carry
you across this boundary.

## What to expect

### Windows

**You will end up with two entries** in Installed apps, "Netscope" 3.x and
"Netscope" 4.x, because the installer treats them as separate applications.
Both will offer to open `.har` files.

Uninstall the 3.x entry once 4.x is working. Nothing is shared between them,
so removing it is safe and won't touch the new install.

### macOS

Nothing to do. Both versions use the same application name, so dragging
Netscope 4 into Applications replaces the old bundle in place, and Finder
prompts to confirm. `.har` files re-associate on first launch.

The old preferences folder is left behind at
`~/Library/Application Support/Netscope`. It's inert and can be deleted; the
new one is `~/Library/Application Support/dev.unremarkable.netscope`.

### Linux

Nothing to do. The `deb` and pacman packages keep the same package name, so
the package manager replaces the old version normally.

## Preferences don't carry over

The recent-files list, theme choice, and any skipped or postponed update are
stored under the app identifier, so Netscope 4 starts with its own. Recent
files are the only one you're likely to notice.

Your HAR files are untouched — Netscope never modifies what it opens, and
nothing about your captures lives inside the app.
