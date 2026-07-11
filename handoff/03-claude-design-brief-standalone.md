# Redesign Netscope's UI

*Self-contained brief — paste this whole document as the prompt and attach the eight
screenshots referenced below. Nothing here points to external files.*

## What I'm asking for

Netscope is a native desktop app for reading and analyzing HTTP Archive (`.har`) files —
essentially Chrome DevTools' Network panel, pulled out into a standalone app for macOS,
Windows, and Linux. The functionality is solid and I'm keeping it. What I want from you is a
**visual and component redesign**: take the existing surfaces and make them look better —
more polished, more considered, more like a product someone designed rather than assembled.
Same information, same layout logic, elevated execution.

Treat the current UI as a *functional wireframe that happens to be colored in*. You have full
latitude on the visual language: type, spacing, density, color, the waterfall, badges, the
detail panel, empty states, focus and hover treatments, iconography. I'd rather you propose a
coherent design system than tweak individual pixels.

## What Netscope is, and the character to honor

A few things about the product that should shape the visual direction:

- **It's a professional tool, viewed for long stretches.** Developers open a HAR to hunt down
  why a page was slow or why a request failed. The UI is information-first and dense by design.
  Favor legibility, scannability, and calm over decoration. It should reward staring at it.

- **It's a native desktop app, not a web page.** It should feel like it belongs on the OS —
  comfortable at a 1400×900 window, usable down to 900×600. Not a marketing site, not a
  dashboard. Think Proxyman, Ghostty, Linear's density — precise, quiet, and confident.

- **It borrows DevTools' mental model, not its pixels.** Anyone who's used the Network panel
  should feel instantly at home with the columns, the waterfall, the detail tabs, and the
  content-type filters. Keep that familiarity in the *structure*; the *execution* is yours to
  reimagine. Don't just clone Chrome's look.

- **The waterfall is the signature element.** The color-coded per-request timing bars are the
  thing that makes this feel like a real network tool rather than a table viewer. Both the
  per-row mini-bars and the Timing-tab phase chart deserve real attention.

- **It's local-first and calm.** Everything happens on the user's machine; there's no account,
  no sync, no cloud, no notifications competing for attention. The design should feel like a
  focused instrument, not a platform.

That's the soul of it. The rest — how windows and files and updates behave — is settled and
not part of this redesign.

## The screenshots (attached)

I've attached eight screenshots of the current app. They're the best single input for
understanding what exists today — clean, high-resolution, and covering every real surface:

1. **Main screen, light** — the request table, toolbar, and summary bar. The core view.
2. **Main screen, dark** — the same view in dark theme.
3. **Main screen with a content-type filter active** — one of the toolbar filter buttons
   selected, narrowing the list.
4. **Main screen with search active** — the filter input in use, showing the "X / Y requests"
   count.
5. **Detail panel — Headers tab** — the panel that slides in from the right when you click a
   request, showing the tab bar and the General / Response Headers / Request Headers layout.
6. **Detail panel — Timing tab** — the per-phase timing bar chart plus the raw timing data
   block.
7. **Detail panel — Source tab with search** — the raw HAR JSON for an entry with in-panel
   find/highlight.
8. **Welcome / empty state** — what you see before a file is open.

**One caveat:** the welcome screenshot reads *"HAR Explorer."* That's an old label — the
product name is **Netscope**, and that's what the current app shows. Design for "Netscope."

**Two surfaces aren't in the screenshots**, so here's what they look like:

- **The request-row right-click menu** is a native OS context menu (Open in Browser; Copy as
  cURL / fetch / fetch-Node / PowerShell / Response; "Copy All Listed" bulk variants; and a
  Sort By submenu). It's rendered by the OS, so it's *not* something you'd restyle — but knowing
  it exists explains why rows are right-clickable.
- **The Payload, Response, and Cookies detail tabs** use the same visual grammar as the Headers
  tab: labeled sections of name/value rows. The Response tab additionally pretty-prints JSON and
  renders base64 images inline.

## Surface & component inventory

Everything you'd be redesigning, grouped by region.

**Welcome / empty state** — an app-icon glyph, the "Netscope" title, a one-line subtitle, an
"Open HAR File" primary button, a `Cmd+O` hint, and an inline error slot for malformed files.
This is the first thing a user sees, and right now it's very plain.

**Toolbar** (top bar, ~40px today) — an "Open" button, the current file name (truncates when
long), a "X / Y requests" count, the filter input with a search icon and an autocomplete
dropdown, and a row of content-type filter buttons: All · XHR · JS · CSS · Img · Font · Doc ·
Media · Other. The autocomplete dropdown suggests both filter keys (`domain:`, `method:`, …)
and live values pulled from the loaded file — it's a real component worth designing well, not
an afterthought.

**Request table** (the main view) — columns: Name (a content-type badge + the resource name +
its domain), Method (color-coded per HTTP verb), Status (color-coded per class, with a
"(from disk cache)" annotation variant), Type (a badge), Size, Time, and Waterfall. Headers are
sortable with an active-sort arrow. Row states that all matter: default, hover, selected, and
error rows (status ≥ 400 or 0) shown in red. The Waterfall cell is a mini horizontal timing bar
per row, laid out on a timeline shared across all rows, built from color-coded phase segments.

**Detail panel** (slides in on the right, ~50% width) — a header showing the request's method +
status + full URL with a close button; a tab bar (Headers · Payload · Response · Timing ·
Cookies · Source); and per-tab content:
- *Headers*: a "General" key/value block, plus Response Headers and Request Headers sections.
- *Timing*: a labeled per-phase bar chart (Queueing, Stalled, Send, Wait/TTFB, Receive) with
  durations, a Total, and a raw-timing key/value block.
- *Source*: the raw HAR JSON for the entry, with an in-panel find (highlight + next/prev).
- *Payload / Response / Cookies*: name/value sections; Response also does JSON pretty-printing
  and inline image rendering.

**Summary bar** (bottom, ~32px) — aggregate stats (requests, transferred, resources, total
time) separated by dividers, a top-5 content-type breakdown, and a System / Light / Dark theme
toggle at the right.

## Current visual language (a starting point, not a constraint)

The app themes entirely through CSS custom properties, so a new design maps cleanly onto a new
token set. Today's tokens, for reference — replace them freely:

- **Type:** a system sans stack (`-apple-system`, Segoe UI, …) for UI; a monospace stack
  (SF Mono, Menlo, …) for URLs, code, and raw data. Base size is a dense **12px**.
- **Radii:** 4 / 6 / 8px. **Key heights:** toolbar 40px, summary bar 32px, and a 52px top inset
  on macOS (for the traffic lights — see constraints).
- **Semantic color families**, each with a light *and* a dark value: status
  (success / redirect / client-error / server-error / error), HTTP method
  (GET / POST / PUT / DELETE / PATCH), timing phases
  (blocked / queueing / dns / connect / ssl / send / wait / receive), and content type
  (document / stylesheet / script / image / font / xhr / other). The current palette is
  Material-ish; you're free to replace it wholesale, as long as every semantic family keeps
  enough distinct, accessible steps in both light and dark.

## Constraints to design within

- **Light and dark are both first-class.** Every surface needs both, they're not an
  afterthought, and System mode follows the OS with no flash on load.
- **Cross-platform window chrome.** On macOS the app uses a hidden-inset title bar with the
  native traffic-light buttons (so content is inset ~52px at the top); on Windows and Linux it
  uses the standard system title bar (no inset). Don't design a custom window frame or custom
  traffic lights — just account for that top inset on macOS.
- **Native OS elements stay native.** The menus, the request-row context menu, file dialogs,
  and update prompts are real OS UI. Design the in-window surfaces (everything in the
  screenshots); leave the OS chrome alone.
- **Keyboard and focus are part of the design.** The app is driven heavily by keyboard, so
  selected-row, focus-ring, and hover states carry real weight. Design them as first-class
  states, not leftovers.
- **Density is a feature.** A power user wants to see a lot of requests at once. Don't trade
  away information density for whitespace — find elegance *within* a dense layout.
- **Implementable in plain CSS with custom properties.** The app uses no CSS framework, so keep
  the system expressible as CSS variables and vanilla styles (no Tailwind/Bootstrap dependency).

## Out of scope

Don't redesign *behavior* — window management, file handling, the filtering logic, keyboard
shortcuts, or the update flow. Those are settled. I need the components to look great, not to
work differently.

## Deliverable

A cohesive visual system for Netscope: the token set (color / type / space / radius, in both
light and dark) and redesigned treatments for each surface above — ideally as component mockups
or a styled reference implementation I can hand to engineering, expressed in plain CSS with
custom properties.
