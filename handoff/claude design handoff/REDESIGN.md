# Netscope redesign — "Instrument" handoff spec

Visual redesign spec for the existing Netscope app. **Behavior is out of scope** — window
management, file handling, filtering logic, keyboard shortcuts, context menus, and the update
flow all stay exactly as they are. This restyles the in-window surfaces only.

Files:
- `netscope-tokens.css` — the complete custom-property set (light / dark / system). Load it
  first; everything below is expressed in those variables.
- The interactive mockup (`Netscope Directions.dc.html` in the design project) is the visual
  reference; turn 2 + 3 cards show every surface.

## Direction in one paragraph

Quiet, cool-graphite chrome; **all color is semantic** (status, method, timing phase, content
type) plus one cobalt accent for selection/focus/active states. UI text is the system sans
stack; every piece of *data* (URLs, methods, status codes, sizes, times, headers, JSON) is
mono. Density stays close to today's (26px rows) — elegance comes from alignment, hairlines,
and restraint, not whitespace.

## Global rules

- Two type families only: `--ns-font-ui` for chrome/labels, `--ns-font-mono` for data.
- Data cells: 11px mono, `--ns-text-muted`. Resource names: 12px/500 UI sans, `--ns-text`.
  Domains: 11px, `--ns-text-faint`, single-line ellipsis.
- Column headers: 10.5px/600 UI sans, UPPERCASE, +0.02em, `--ns-text-muted`, on
  `--ns-surface-raised`, height `--ns-colheader-h`. Active sort column: `--ns-text` with an
  accent-colored ▲/▼.
- Hairlines: structural = `--ns-hairline`, row separators = `--ns-hairline-soft`.
- macOS: 52px top inset for traffic lights (`--ns-inset-macos`); Windows/Linux: none.
- Native menus/dialogs stay native. Do not restyle.

## Row states (request table)

| State    | Treatment |
|----------|-----------|
| default  | `--ns-surface`, hairline-soft bottom border |
| hover    | `--ns-surface-raised`-equivalent tint (light `#f4f6f9`, dark `#22262c`) |
| selected | `--ns-accent-tint` bg + `inset 2px 0 0 var(--ns-accent)` left bar |
| error (status ≥ 400 or 0) | name + status in `--ns-status-4xx`, bg `--ns-error-tint` |
| keyboard focus | same as selected; the selection *is* the focus. Focused controls get `box-shadow: 0 0 0 3px var(--ns-focus-ring)` outside a 1px accent border |

Selected + error can combine (tint + red text).

## Component specs

### Content-type badge
34px wide, centered, 8.5px/600 mono caps +0.05em, `--ns-type-*` text on `--ns-type-*-bg`,
radius `--ns-r-badge`, 2.5px vertical padding. Labels: DOC CSS JS IMG FONT XHR (Media→other).

### Method / status
Method: 11px/600 mono in `--ns-method-*`. Status: 11px/500 mono in the status-class color;
`(disk cache)` annotation: 10px UI sans `--ns-text-faint` after the code. Status 0 renders
as `--ns-status-4xx`.

### Waterfall (per-row)
- Cell is a shared timeline across all rows (0 = first request start, 100% = capture end).
- Bar: 8px tall, radius 2px, min segment width 2px; segments butt-joined in phase order:
  blocked/queueing → dns → connect → ssl → send → wait → receive, each in `--ns-phase-*`.
- No track background in rows.

### Timing tab
Same phase colors. Each phase row: 22px — color chip (9px, r3) + label (11px UI sans, nowrap,
112px column) + 7px track (`--ns-hairline-soft`, radius 3) with the phase segment positioned
on the request's own 0–100% duration + right-aligned mono duration. Total row above a
hairline: 11.5px/600 label, 12px/600 mono value. Raw Timing Data: key/value grid (150px mono
key column, `--ns-text-muted` keys) on `--ns-surface-raised` in a `--ns-r-card` border box;
HAR field names verbatim (`_blocked_queueing`, …).

### Detail panel
- Slides in right, ~50% width; list collapses to Name · Method · Status · Time.
- Header (40px): method + status (colored mono) + full URL (11.5px mono, ellipsis) + close.
- Tab bar (34px): 11.5px tabs; active = 600 weight, accent text, `inset 0 -2px 0 var(--ns-accent)`.
- Headers/Payload/Cookies: section title 11px/600 UI sans + count in faint mono; key/value
  grid — 170px mono key column in `--ns-text-muted`, values mono `--ns-text`; sections split
  by hairline-soft. Long values clamp to 3 lines (expand on click — existing behavior).
- Response: meta strip (type · size · dims), Pretty/Raw segmented switch for JSON, Copy /
  Save As… ghost buttons. JSON syntax tint: keys `--ns-method-get`, strings `--ns-status-2xx`,
  numbers `--ns-method-put`, booleans/null `--ns-method-patch`, punctuation `--ns-text-muted`.
  Images: render inline, centered on a 16px checkerboard of surface-raised/hairline-soft,
  base64 collapsed behind a "Show raw data" link.
- Source: find bar (focused style = accent border + focus ring) with match count `n of m`
  (faint mono), ▲ ▼ chips, ×; match highlight = 35% `--ns-phase-connect` (amber) bg + 1px
  ring; code on `--ns-surface-sunken`-style recessed block (`--ns-surface-raised` light).

### Toolbar
44px. Open = standard button (surface bg, hairline border, r6, subtle 1px shadow in light).
Filename 12.5px/600. Count in mono — plain muted when unfiltered, `--ns-accent` when a
filter narrows it ("43 / 277"). Filter input: 27px, r6, mono once typing; focused = accent
border + focus ring. Type filters: segmented control on `--ns-surface-sunken` track (r7);
active chip = surface bg, accent text, 600, 1px shadow.

### Autocomplete dropdown
`--ns-surface`, r8, hairline border, shadow `0 8px 28px rgba(20,24,33,.14)`. Group label:
9.5px/600 caps faint. Items 26px: mono suggestion with matched substring in accent 600 +
right-aligned faint match count. Active item = accent tint + 2px accent left inset. Footer
strip on `--ns-surface-raised`: key chips + "↑↓ navigate · ⏎ apply" hint.

### Summary bar
32px, `--ns-bg`, hairline top. Stats: 11px, values 600 `--ns-text`, labels `--ns-text-muted`,
1px hairline dividers, `white-space: nowrap`. Theme toggle: small segmented control, right.

### Welcome
Centered stack: 56px app glyph (r14 surface card, three staggered waterfall bars in
phase-receive/wait/connect colors) → "Netscope" 19px/600 −0.01em → 12.5px muted subtitle
(`.har` in a mono kbd chip) → accent primary button (32px, r7) → "or press ⌘O" with a
bordered kbd chip. Error slot below: r7 box, `--ns-error-tint`-style bg + 25% 4xx border,
"!" chip + 11.5px message.

## Guardrails

- No CSS framework; only `netscope-tokens.css` variables + vanilla styles.
- Don't introduce new colors — every color on screen must be a token.
- Don't change row height/density beyond the spec; don't add decoration, gradients, or
  new iconography beyond what's specced.
- Keep both themes first-class: every new style must reference tokens so dark works free.
- System theme must not flash on load (tokens file handles it via `prefers-color-scheme`;
  only set `data-theme` when the user explicitly picks Light/Dark).
