# Netscope — Design Philosophy

This is a description of *how Netscope is meant to work and why*, reconstructed from the
`main` branch (the shipping Electron app) and its git history. It is the shared reference
for both the Claude Design brief and the Fable 5 rewrite brief.

Everything in the numbered sections below describes **how the app actually works today**.
Anything I'm proposing as a change lives in a separate file
([`05-my-observations-and-suggestions.md`](05-my-observations-and-suggestions.md)) and is
never mixed into this description.

---

## 1. What the app is

Netscope is a native, local-first desktop app for reading and analyzing HTTP Archive
(`.har`) files. The mental model is Chrome DevTools' Network panel, pulled out into a
standalone document viewer for macOS, Windows, and Linux.

Two commitments shape everything else:

**It's local-first for a reason, not by accident.** HAR captures carry cookies, auth
tokens, and full session data. The app never uploads a file anywhere — the only network
request it makes is the update check. That's the whole argument for it being a desktop app
instead of a web tool, and it should stay that way. Response bodies, headers, everything is
parsed and rendered in-process on the user's machine.

**It's a document app, and it takes the document metaphor seriously.** A `.har` is a
document. So Netscope behaves the way a well-built native document app behaves: file
associations, one window per document, a represented file / proxy icon on macOS, a Recent
Documents menu, and OS-level integration for opening files. It is not a single-window SPA
that happens to load files. This is the through-line for most of the shell decisions below.

The scope is deliberately narrow: it's a *read-only* inspector. No editing, no request
replay inside the app, no collections or workspaces. The "reproduce this request" workflow
is served by copy-to-clipboard formatters, not by an in-app HTTP client.

---

## 2. Shell & windowing (the decisions that are mine)

The renderer UI is Claude-generated; the way the app *shell* behaves is where I made most
of the calls. These are the load-bearing ones.

### Multi-window, document-oriented — not tabs

Each HAR opens in its own OS window, like TextEdit or Preview. There's intentionally no tab
bar and no workspace concept. Windows are the unit of "a file I'm looking at."

### Deduplicate aggressively

Opening a file that's already open **focuses the existing window** instead of making a
second copy. This holds across every entry point — the Open dialog, Open Recent, the dock,
Finder double-click, drag-onto-dock, command line. There's a single `findWindowForFile`
notion that everything routes through. The user should never end up with two windows
showing the same capture by accident.

### Reuse the welcome window — but only when it's focused

An empty "welcome screen" window (no file loaded yet) gets reused when you open a file into
it, rather than spawning a new window and leaving an empty one behind. But this only happens
when the welcome window is the **focused** window. An unfocused welcome window is never
silently taken over. That distinction was a deliberate fix: silently replacing a background
welcome window is surprising when you're juggling several windows. (See commit `b615d4c`.)

### Cascade new windows so title bars stay visible

New windows are offset 28px down-and-right from a reference window so their title bars don't
stack exactly on top of each other. **Note a real behavioral difference between the two
branches here:** the Electron app cascades from the *most-recently-created* window (so
window 3 lands below window 2 even if window 1 is focused). The abandoned Tauri rewrite
deliberately changed this to cascade from the *focused* window, citing Ghostty/Chrome
behavior (refocus an earlier window and the next new window cascades from that one). Both are
defensible; they are not the same rule, and a rewrite needs to pick one on purpose. My lean
is documented in the observations file.

### No flash of the welcome screen when opening a file

When a window is created to show a file, it stays hidden until the renderer signals that the
HAR is parsed and on screen — with an 800ms timeout as a safety net for very large files.
The user should see the content appear, not watch an empty welcome screen repaint into a
table. This is polish I paid for on purpose.

### One process owns all the windows (single-instance)

On Windows and Linux, the app takes a single-instance lock. A second launch (e.g.
double-clicking another `.har`) doesn't spawn a second process — it hands its file path to
the already-running instance and exits. macOS gets this behavior natively through the
`open-file` event. The payoff is that dedup, welcome-window reuse, and cascade all work
uniformly no matter how a file gets opened, and startup stays fast.

### Multi-file open

Selecting several files at once in the Open dialog loads the first into the current window
(or the focused welcome window), and opens each remaining file in its own window — deduped,
so re-selecting an already-open file just focuses it.

### Platform-honest chrome

macOS uses a hidden-inset title bar with the native traffic lights repositioned; Windows and
Linux use their normal system title bar. A `--titlebar-height` CSS variable is 52px on macOS
and 0 elsewhere so the content lines up under the traffic lights only where it needs to.
Menus, the request-row context menu, file dialogs, and update prompts are all **native OS
UI**, not HTML reimplementations. The app should feel like it belongs on each platform, not
like a web page in a frame.

### Keyboard-first, with a deliberate focus model

Full keyboard navigation in the request table (arrows, `j`/`k`, `Home`/`End`,
`Cmd+Up`/`Cmd+Down`, `Enter`/`Space` to toggle the detail panel), plus global shortcuts (`/`
and `Cmd+F` to focus the filter, `Esc`, `Cmd+N`, `Cmd+O`, `Cmd+W`). The important subtlety:
table shortcuts only fire when the table itself has focus. Move focus into the detail panel
and the arrow keys scroll its content instead of moving the row selection; move into the
filter input and they type. `Escape` unwinds in a ladder — it closes the Source-tab search
first, then the detail panel, then returns focus to the table. This keeps a power user's
hands on the keyboard without the shortcuts fighting each other.

---

## 3. Interaction & functionality

### DevTools parity as the North Star, without being slavish

The column layout (Name with a type badge + domain, Method, Status, Type, Size, Time,
Waterfall), the color-coded waterfall with per-phase segments, the detail-panel tabs
(Headers, Payload, Response, Timing, Cookies, Source), and the content-type filter tabs all
mirror the DevTools mental model so anyone who's used the Network panel is instantly at home.
It borrows the model, not the pixels.

### Structured, composable filtering

The filter input is more than substring search. It parses a DevTools-style query language:
`domain:`, `method:`, `status-code:` (with `4xx`-style ranges), `mime-type:`, `larger-than:`
(with `k`/`M` units), `scheme:`, `has-response-header:`, and explicit `url:`. Tokens are
AND-combined, any token can be negated with a leading `-`, and values with spaces can be
quoted. Autocomplete suggests both filter keys *and* actual values pulled from the loaded
file — the real domains, methods, status codes, MIME types, and header names in *this*
capture. Toolbar content-type buttons are a second, separate filter layer AND-ed with the
text query. Default sort is Waterfall ascending, i.e. chronological — the order the requests
actually happened.

### "I found the request, now reproduce it"

The right-click context menu on a row is a core workflow, not a nicety: Open in Browser, and
Copy as cURL / fetch (browser, with forbidden headers stripped) / fetch (Node.js, all headers
kept) / PowerShell / raw response body — each with a bulk "Copy All Listed …" variant that
operates on the currently filtered set. The copy formatters are pure functions with full unit
coverage, which is *why* the native menu (which runs in the main process) can import and call
them directly.

### Deliberate non-goals in the architecture

Several things are intentionally *not* there, and the codebase documents them as
"don't add this without a real reason":

- **No external state library.** All state lives in `App.tsx` and flows down as props.
- **No row virtualization.** The table renders every row as real DOM. Fine for typical
  captures (hundreds to low thousands); revisit only if very large files actually hurt,
  because virtualization complicates keyboard nav and scroll-into-view.
- **No CSS framework.** Plain CSS with `--color-*` / sizing custom properties, BEM-ish class
  names, theming via `prefers-color-scheme`. No Tailwind, CSS modules, or CSS-in-JS.
- **Pure utilities, thin components.** Anything testable without React (parsing, filtering,
  formatting) is a pure function in `src/utils/` with tests; components stay presentational.

These are constraints a rewrite should respect *as defaults* and only break with a stated
reason.

### Theming

System / Light / Dark, toggled from the summary bar and persisted to `localStorage`. System
mode follows the OS via `prefers-color-scheme` with no flash on load. All colors go through
CSS custom properties — there are no hardcoded colors in component styles.

---

## 4. Release & auto-update

This is the other area where the decisions are mine, and there's more intent here than the
code size suggests.

### Built in CI, per-platform, signed where it matters

Releases are tag-driven (`v*`) and built by a GitHub Actions matrix across macOS, Windows,
and Linux, each runner building its own platform and publishing to one shared GitHub Release.
macOS builds are code-signed with a Developer ID cert and notarized so Gatekeeper doesn't
block them; the workflow even verifies the signature after building. Windows ships unsigned
on purpose (accepting the first-run SmartScreen warning as a cost tradeoff). Linux ships
AppImage, deb, **and pacman** — pacman specifically because Arch doesn't ship FUSE 2 by
default, which AppImage needs at runtime. The recurring theme: care about whether the build
actually installs and launches cleanly for a real user on their real platform.

### Two channels, cleanly separated

A stable channel (`latest-*` manifests) and a nightly channel (dated pre-releases like
`v3.2.3-nightly.20260514`, separate `nightly-*` manifests). The build channel is injected at
build time. Stable users are never pulled onto a nightly build. Nightly fires daily, on push
to the nightly branch, and on manual dispatch.

### Auto-update that respects the user

The single most deliberate decision in this area was moving *away* from silent auto-update.
The app now:

- **Prompts before doing anything** when an update is available: Install Update / Remind Me
  Later / Skip This Version. "Remind Me Later" is remembered for the rest of the calendar day
  (so it doesn't nag on every launch); "Skip This Version" is persisted until a newer version
  exists. Both live in a `preferences.json` in the app's user-data dir.
- **Shows download progress** on the dock/taskbar, and surfaces failures as a real dialog
  instead of failing silently.
- **Restores your open files** after an update-triggered restart — it saves the set of open
  file paths before `quitAndInstall` and reopens them once, then clears that state. The point
  is that updating shouldn't cost you your place.
- **Surfaces update status in the About panel** ("version X is ready — restart to install").

The user decides when they update, and updating is designed to be non-disruptive.

### Release hygiene

Version bumps are their own commits, never bundled into feature commits. Releases go through
a scripted bump → tag → push flow. Code changes and version changes stay separated in history.

---

## 5. The one-paragraph version

Netscope is a native, local-first, document-oriented HAR viewer that gives you the DevTools
Network panel as a proper desktop app. The shell behaves like a real document application —
one window per file, dedup and welcome-window reuse across every open path, cascade
positioning, single-instance process ownership, native menus and dialogs, and a
keyboard-first focus model. The functionality mirrors DevTools' mental model (columns,
waterfall, detail tabs, structured composable filters, copy-as-cURL/fetch/PowerShell) while
staying a focused read-only tool with deliberately minimal architecture. Distribution is
CI-built and signed per platform, split into stable and nightly channels, with an
auto-updater that asks first, shows progress, and puts your open files back after it
restarts.
