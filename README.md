<p align="center">
  <img src="images/netscope.png" alt="Netscope icon" width="128" />
</p>

# Netscope

A native macOS desktop application for viewing and analyzing HTTP Archive (HAR) files. Built with Electron, React, and TypeScript.

Netscope gives you the same network inspection experience as Chrome DevTools, but as a standalone app -- open HAR files from Finder, filter and sort requests, inspect headers and timing, and search through raw source data.

![Netscope main screen showing a list of network requests](images/main-screen.png)

## Features

### Request list with sorting and waterfall

Every request is displayed in a sortable table with method, status, content type, transfer size, duration, and a color-coded waterfall chart. Click any column header to sort.

### Filter by content type or search by URL

Use the content type tabs (XHR, JS, CSS, Img, Font, Doc, Media, Other) to narrow down the list, or type in the search bar to filter by URL.

| Filter by type | Search by URL |
|---|---|
| ![Filtering by image type](images/main-screen-filter.png) | ![Searching for "player"](images/main-screen-search.png) |

### Detailed request inspection

Click any request to open the detail panel. The Headers tab shows general info, request headers, and response headers. Other tabs show payload, response body, cookies, and timing data.

![Detail panel showing headers for an XHR request](images/details-headers.png)

### Timing breakdown

The Timing tab visualizes the request lifecycle -- queueing, stalled, send, wait (TTFB), and receive -- with a horizontal bar chart and raw timing data.

![Timing breakdown showing TTFB and other phases](images/details-timing.png)

### Source search

The Source tab shows the raw HAR JSON for any entry. Open the search bar with Cmd+F, type a query, and matching text is highlighted inline. Navigate between matches with Enter, Shift+Enter, or Cmd+G.

![Source tab with search highlighting](images/details-raw-with-search.png)

### Dark mode

Switch between System, Light, and Dark themes using the toggle in the bottom-right corner. Your preference is saved across sessions.

![Netscope in dark mode](images/main-screen-dark.png)

### Other features

- **Three ways to open files** -- Use File > Open (Cmd+O), drag-and-drop onto the window, or double-click `.har` files in Finder
- **Multi-window support** -- Each HAR file opens in its own window; re-opening an already-open file focuses the existing window
- **Disk cache detection** -- Responses served from the browser cache are labeled "(from disk cache)" on the status code
- **Summary bar** -- Aggregate stats at the bottom: total requests, transfer size, resource size, total time, and breakdown by type
- **Response preview** -- Auto-formatted JSON, rendered base64 images, and raw text display
- **Code-signed and notarized** -- Signed with a Developer ID certificate and notarized by Apple, so macOS Gatekeeper won't block it

## Installation

Download the latest `.dmg` from [Releases](https://github.com/Dru89/netscope/releases), open it, and drag Netscope to your Applications folder.

To set Netscope as the default handler for `.har` files:

1. Right-click any `.har` file in Finder
2. Choose **Get Info**
3. Under **Open with**, select **Netscope**
4. Click **Change All...**

## Development

```bash
# Install dependencies
npm install

# Run in development mode (hot reload)
npm run dev

# Build the packaged .app and .dmg (unsigned)
npm run build

# Build, sign, notarize, and publish to GitHub Releases
npm run release
```

### Release builds

The `release` script signs the app with a Developer ID certificate, notarizes it with Apple, and uploads the DMG to GitHub Releases. It requires credentials in a `.env` file -- see [`.env.example`](.env.example) for the required variables.

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server + Electron with hot reload |
| `npm run build` | Type-check, bundle, and package the app with electron-builder |
| `npm run build:vite` | Type-check and bundle only (no electron-builder packaging) |
| `npm run release` | Tag, build, sign, notarize, and publish to GitHub Releases |

## Tech Stack

- **Electron 28** -- Desktop runtime with native macOS integration
- **React 18** -- UI framework
- **TypeScript 5** -- Type safety
- **Vite 5** -- Build tooling and dev server
- **electron-builder** -- Packaging and distribution

## License

MIT
