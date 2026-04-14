# Features Guide

A walkthrough of every feature in Netscope.

## Opening Files

There are four ways to open a HAR file:

### 1. File Menu / Keyboard Shortcut

Press **Cmd+O** or go to **File > Open HAR File...** in the menu bar. A native file picker opens, filtered to `.har` files by default.

### 2. Drag and Drop

Drag a `.har` file from Finder (or any other source) and drop it anywhere on the Netscope window. The file loads immediately.

### 3. Double-Click in Finder

After setting Netscope as the default handler for `.har` files (see [README](../README.md#setting-as-default-har-handler)), double-clicking a `.har` file in Finder opens it directly in the app.

### 4. Command Line

```bash
open "release/mac-arm64/Netscope.app" --args /path/to/file.har
```

When a file is opened while the app is already running, it replaces the current file. The previous file's state (selected entry, filters) is cleared.

---

## Request List

The main view is a table showing every HTTP request in the HAR file. Each row displays:

| Column | Content |
|--------|---------|
| **Name** | Resource name (last path segment) with content type badge and domain |
| **Method** | HTTP method, color-coded (GET=blue, POST=green, PUT=orange, DELETE=red, PATCH=purple) |
| **Status** | HTTP status code, color-coded (2xx=green, 3xx=orange, 4xx=red, 5xx=dark red, 0=error) |
| **Type** | Content type classification badge |
| **Size** | Transfer size (compressed on-the-wire size) |
| **Time** | Total request duration |
| **Waterfall** | Visual timing bar showing request phases |

### Sorting

Click any column header to sort by that column. Click again to reverse the direction. The active sort column is highlighted, with an arrow indicating the direction.

The default sort is **Waterfall** (ascending), which shows requests in chronological order -- the same as they appeared in the network trace.

### Error Highlighting

Requests with status codes >= 400 or status 0 (failed/aborted) are displayed in red text to make errors easy to spot.

---

## Waterfall Chart

The **Waterfall** column renders a horizontal bar for each request, positioned relative to the start of the entire HAR recording. Each bar is composed of color-coded segments representing the timing phases:

| Phase | Color | Meaning |
|-------|-------|---------|
| Blocked | Grey | Time spent queued or blocked by the browser |
| DNS | Teal | DNS lookup time |
| Connect | Orange | TCP connection establishment |
| TLS | Purple | TLS/SSL handshake (subset of Connect) |
| Send | Light blue | Time to transmit the request |
| Wait (TTFB) | Green | Time waiting for the first byte of the response |
| Receive | Blue | Time to download the response body |

Hover over any segment to see a tooltip with the phase name and duration.

The bar positions are calculated relative to the earliest `startedDateTime` across all entries, so the waterfall accurately represents the timeline of the entire recording.

---

## Detail Panel

Click any request row to open the detail panel on the right side of the window. The panel has five tabs:

### Headers Tab

Shows the full details of the request and response:

- **General section** -- URL, method, status, HTTP version, remote IP address, start time, duration, content type, transfer size, and resource size
- **Response Headers** -- Every response header as a name/value table
- **Request Headers** -- Every request header as a name/value table

All values in the headers tables are selectable for copying.

### Payload Tab

Shows the data sent with the request:

- **Query String Parameters** -- URL query parameters, parsed into a name/value table
- **Request Body** -- The POST/PUT/PATCH body, displayed as:
  - A name/value table for form-encoded data (`application/x-www-form-urlencoded`)
  - Auto-formatted JSON for JSON bodies
  - Raw text for everything else

If the request has no query string or body, the tab displays "No payload data for this request."

### Response Tab

Shows the response body content:

- **JSON responses** are automatically pretty-printed with indentation
- **Images** with base64-encoded content are rendered inline as actual images
- **Other text content** (HTML, CSS, JS, XML) is displayed as raw text
- If the response body wasn't captured in the HAR file, a message shows the response size

### Timing Tab

Shows a detailed breakdown of the request timing:

- **Visual bar chart** -- Each timing phase is displayed as a labeled row with a proportional bar and the exact duration
- **Total time** -- Sum displayed at the bottom
- **Raw timing data** -- The raw values from the HAR file's `timings` object

### Cookies Tab

Shows cookies associated with the request:

- **Request Cookies** -- Cookies sent with the request
- **Response Cookies** -- Cookies set by the response (`Set-Cookie` headers), including metadata (Domain, Path, HttpOnly, Secure)

---

## Filtering

### Text Search

The search field in the toolbar filters requests in real time. Plain text matches against both the full URL and the resource name (case-insensitive).

### Structured Filters

The search field also supports Chrome DevTools-style structured filters using `key:value` syntax. Multiple filters are separated by spaces and AND'd together.

| Filter | Example | What it matches |
|--------|---------|-----------------|
| (plain text) | `api` | URL or entry name substring |
| `domain:` | `domain:*.example.com` | Request domain (supports `*` wildcard) |
| `method:` | `method:POST` | HTTP method |
| `status-code:` | `status-code:4xx` | Status code (exact, or range like `4xx`, `5xx`) |
| `mime-type:` | `mime-type:json` | Response MIME type substring |
| `larger-than:` | `larger-than:1k` | Transfer size threshold (`k` = kilobytes, `M` = megabytes) |
| `scheme:` | `scheme:https` | URL scheme (`http` or `https`) |
| `has-response-header:` | `has-response-header:x-custom` | Presence of a response header |
| `url:` | `url:/api/v2` | URL substring (explicit) |

Prefix any filter with `-` to negate it. For example, `-domain:analytics.com` excludes requests to that domain. Values with spaces can be quoted: `domain:"my site.com"`.

### Autocomplete

The filter input provides autocomplete suggestions as you type:

- **Filter type suggestions:** When typing the start of a token, the dropdown suggests matching filter types. For example, typing `do` shows `domain:`.
- **Value suggestions:** After typing a filter key followed by a colon (e.g., `method:`), the dropdown shows actual values from the loaded HAR file -- unique domains, HTTP methods, status codes, MIME types, URL schemes, and response header names.
- **Keyboard:** Use Up/Down arrows to navigate suggestions, Enter or Tab to accept, Escape to dismiss.
- `larger-than:` and `url:` are freeform and don't offer value suggestions.

### Content Type Filter

The toolbar has filter buttons for common content types:

| Button | Matches |
|--------|---------|
| All | Show all requests (clear filter) |
| XHR | JSON and XML responses (API calls) |
| JS | JavaScript files |
| CSS | Stylesheets |
| Img | Images (PNG, JPEG, GIF, SVG, WebP, ICO) |
| Font | Web fonts (WOFF, WOFF2, TTF, OTF) |
| Doc | HTML documents |
| Media | Video and audio files |
| Other | Anything not matching the above categories |

Click a button to activate the filter. Click the same button again to deactivate it. Only one content type filter can be active at a time. The text search/structured filters and the content type filter work together -- both must match for a request to be shown.

The toolbar shows the filter status as "X / Y requests" when a filter is active.

---

## Keyboard Shortcuts

### Table Navigation (when the request table has focus)

| Shortcut | Action |
|---|---|
| Up / k | Select previous entry |
| Down / j | Select next entry |
| Cmd+Up / Home | Select first entry |
| Cmd+Down / End | Select last entry |
| Enter / Space | Toggle detail panel for selected entry |

### Global Shortcuts

| Shortcut | Action |
|---|---|
| Escape | Close detail panel and return focus to table; blur filter input |
| / | Focus the toolbar filter input |
| Cmd+F | Focus the toolbar filter (unless focus is in the detail panel) |

The table container must have focus for table navigation shortcuts to work. Clicking a row gives it focus. When focus moves to the detail panel or filter input, table shortcuts stop firing, so arrow keys and j/k don't interfere with typing or scrolling. Pressing Escape returns focus to the table.

---

## Summary Bar

The bottom bar shows aggregate statistics for the entire HAR file (not affected by filters):

- **Request count** -- Total number of entries
- **Transfer size** -- Total compressed/on-the-wire bytes
- **Resource size** -- Total uncompressed bytes
- **Total time** -- Wall clock time from the first request start to the last request end
- **Type breakdown** -- Count of requests per content type (top 5)

---

## Theme

Netscope supports three theme modes: **System**, **Light**, and **Dark**. Switch between them using the toggle in the bottom-right corner of the summary bar. Your preference is saved to `localStorage` and persists across sessions.

In System mode, the app follows your operating system's appearance setting automatically. The theme is implemented with CSS custom properties and a `@media (prefers-color-scheme: dark)` query, so transitions are instantaneous with no flash.

---

## Window Behavior

- The title bar uses the macOS `hiddenInset` style with native traffic light buttons (close/minimize/fullscreen) positioned in the upper left. On Windows and Linux, the default system title bar is used.
- The title bar area is draggable for moving the window
- Minimum window size is 900x600 pixels
- The detail panel takes up 50% of the width when open, with the request list occupying the other 50%
