# Brief for Claude Design — Redesign Netscope's UI

## What I'm asking for

Netscope is a native desktop app for reading HTTP Archive (`.har`) files — think Chrome
DevTools' Network panel as a standalone macOS/Windows/Linux app. The functionality is solid
and I want to keep it. What I want from you is a **visual and component redesign**: take the
existing surfaces and make them look better — more polished, more considered, more like a
product someone designed rather than assembled. Same information, same layout logic, elevated
execution.

Treat the current UI as a *functional wireframe that happens to be colored in*. You have full
latitude on the visual language: type, spacing, density, color, the waterfall, badges, the
detail panel, empty states, focus and hover treatments, iconography. I'd rather you propose a
coherent design system than tweak individual pixels.

## Should you look at the screenshots? Yes.

Include all of these — they're clean, high-resolution captures of every real surface and are
the best single input for understanding what exists today:

| Screenshot | Surface it shows |
| --- | --- |
| `images/main-screen.png` | Request table, toolbar, summary bar (light) |
| `images/main-screen-dark.png` | Same, dark theme |
| `images/main-screen-filter.png` | Content-type filter active |
| `images/main-screen-search.png` | Text/structured search active |
| `images/details-headers.png` | Detail panel — Headers tab + tab bar |
| `images/details-timing.png` | Detail panel — Timing tab (phase bars + raw data) |
| `images/details-raw-with-search.png` | Detail panel — Source tab with in-panel search highlighting |
| `images/welcome.png` | Empty/welcome state |

**One caveat on the screenshots:** they're a build or two old in exactly one spot — the
welcome screen reads *"HAR Explorer"* in the image, but the product name is **Netscope** (the
current code already says "Netscope"). Design for "Netscope." Everything else in the
screenshots is current.

The screenshots don't cover two things, so I'm calling them out: the **request-row right-click
context menu** (native OS menu: Open in Browser; Copy as cURL / fetch / fetch-Node /
PowerShell / Response; Copy All Listed variants; Sort By) and the **Payload / Response /
Cookies** detail tabs (same visual grammar as the Headers tab — labeled sections with
name/value rows; Response also renders pretty-printed JSON and inline base64 images).

## Surface & component inventory

Everything you'd be redesigning, grouped by region:

**Welcome / empty state** — app icon glyph, "Netscope" title, one-line subtitle, "Open HAR
File" primary button, `Cmd+O` hint, and an inline error slot (for malformed files). This is
the first thing a user sees.

**Toolbar** (top bar, ~40px today) — "Open" button, current file name (truncates), a
"X / Y requests" count, the filter input with a search icon and autocomplete dropdown, and a
row of content-type filter buttons: All · XHR · JS · CSS · Img · Font · Doc · Media · Other.
The filter input's autocomplete dropdown suggests both filter keys (`domain:`, `method:`, …)
and live values from the loaded file — that dropdown is a component worth designing well.

**Request table** (the main view) — columns: Name (content-type badge + resource name +
domain), Method (color-coded), Status (color-coded, with a "(from disk cache)" annotation
variant), Type (badge), Size, Time, and Waterfall. Sortable headers with an active-sort
arrow. Row states: default, hover, selected, and error rows (status ≥ 400 or 0) shown in red.
The waterfall cell is a mini horizontal timing bar per row, positioned on a shared timeline,
built from color-coded phase segments.

**Detail panel** (slides in on the right, ~50% width) — a header showing method + status +
full URL with a close button, a tab bar (Headers · Payload · Response · Timing · Cookies ·
Source), and per-tab content:
- *Headers*: a "General" key/value block plus Response Headers and Request Headers sections.
- *Timing*: a labeled per-phase bar chart (Queueing, Stalled, Send, Wait/TTFB, Receive) with
  durations, a Total, and a raw-timing key/value block.
- *Source*: raw HAR JSON for the entry with an in-panel find (highlight + next/prev).
- *Payload / Response / Cookies*: name/value sections; Response also does JSON pretty-print
  and inline image rendering.

**Summary bar** (bottom, ~32px) — aggregate stats (requests, transferred, resources, total
time) with separators, a top-5 type breakdown, and a System / Light / Dark theme toggle on the
right.

## Current visual language (starting point, not a constraint)

The app themes entirely through CSS custom properties, so a redesign maps naturally onto a new
token set. Today's tokens, for reference:

- **Type:** system sans (`-apple-system`, Segoe UI, …) for UI; a mono stack (SF Mono, Menlo,
  …) for URLs, code, and raw data. Base font size is a dense **12px**.
- **Radii:** 4 / 6 / 8px. **Sizing:** toolbar 40px, summary 32px, macOS titlebar inset 52px.
- **Semantic color families** (each with a light and dark value): status
  (success/redirect/client-error/server-error/error), HTTP method (GET/POST/PUT/DELETE/PATCH),
  timing phases (blocked/queueing/dns/connect/ssl/send/wait/receive), and content type
  (document/stylesheet/script/image/font/xhr/other). The current palette is Material-ish;
  you're free to replace it wholesale as long as every semantic family keeps enough distinct,
  accessible steps in both themes.

## Constraints to design within

- **It's a native desktop app, not a web page.** Dense, information-first, comfortable at a
  1400×900 window down to a 900×600 minimum. This is a tool professionals stare at, so favor
  legibility and scannability over marketing flourish.
- **Light and dark are both first-class.** Every surface needs both. System mode follows the
  OS. No flash on load.
- **Cross-platform chrome.** macOS uses a hidden-inset title bar with native traffic lights
  (content insets 52px at top); Windows/Linux use the system title bar (0 inset). Don't design
  a custom window frame or custom traffic lights.
- **Native OS elements stay native.** Menus, the request-row context menu, file dialogs, and
  update prompts are real OS UI. Don't reskin those — design the in-window React surfaces.
- **Keyboard and focus are part of the design.** Selected-row, focus-ring, and hover states
  carry real weight because this app is driven heavily by keyboard. Design them as first-class
  states, not afterthoughts.
- **The waterfall is the signature element.** It's the thing that makes this feel like a real
  network tool. Both the per-row mini-bars and the Timing-tab phase chart deserve attention.

## Explicitly out of scope

Don't redesign *behavior* — window management, file handling, filtering logic, keyboard
shortcuts, the update flow. Those are settled and described in
[`01-design-philosophy.md`](01-design-philosophy.md) if you want the context, but they're not
what I need from you. I need the components to look great.

## Deliverable

A cohesive visual system for Netscope: the token set (color/type/space/radius, light + dark),
and redesigned treatments for each surface above — ideally as component mockups or a styled
reference implementation I can hand to engineering. Keep it implementable in plain CSS with
custom properties (no framework dependency), since that's the app's styling model.
