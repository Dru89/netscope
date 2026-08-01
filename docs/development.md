# Development

## Getting started

Prerequisites: Node 24+, a Rust toolchain (stable), and Tauri's platform
dependencies (on Debian/Ubuntu: `libwebkit2gtk-4.1-dev build-essential
libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`; macOS
needs Xcode command line tools; Windows needs the MSVC build tools and
WebView2).

```bash
# Install dependencies
npm install

# Run the app in development mode (Vite dev server + Tauri shell, hot reload)
npm run dev

# Renderer only, in a browser (no native shell; load a fixture via
# http://localhost:5173/?fixture=/test/fixtures/www.example.com.har)
npm run dev:renderer

# Type-check and bundle the renderer
npm run build:vite

# Build the packaged app for your platform
npm run build

# Run tests
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

## Scripts

| Script                 | Description                                             |
| ---------------------- | ------------------------------------------------------- |
| `npm run dev`          | Tauri dev: Vite dev server + Rust shell with hot reload |
| `npm run dev:renderer` | Vite dev server only (renderer in a browser)            |
| `npm run build`        | Full production build + bundles (`tauri build`)         |
| `npm run build:vite`   | Type-check and bundle the renderer only                 |
| `npm test`             | Renderer unit tests (Vitest)                            |
| `npm run test:e2e`     | WebDriver E2E against the release binary (Linux)        |

`make` targets wrap these plus `make icons`, `make release`, and
`make test-e2e` — see the Makefile.

### Local production builds

Production builds with the updater enabled need
`TAURI_SIGNING_PRIVATE_KEY` (and `_PASSWORD`) in the environment.

**Nothing in this project reads a `.env` file.** The Tauri CLI has no
dotenv support, and `dotenv` isn't a dependency here (it was under
Electron; it isn't now). Export the variables in your shell, or pass them
inline on the command line — a `.env` you create will be silently ignored.
See `.env.example` for the full list.

Without the signing key, build a real `.app` like this:

```bash
npx tauri build --no-sign --bundles app
```

`--no-sign` skips updater signing, so no key is needed. `--bundles app`
narrows the output to the `.app`, skipping the DMG step — that one mounts
a volume and drives Finder via AppleScript, which is slow and fragile.

Use `--no-bundle` only when you want the bare binary and no `.app` at all;
it's what CI and `make test-e2e` use, and it is _not_ what you want for
testing file associations, the dock, or Finder double-click.

Drag the resulting `.app` into /Applications before testing file
associations — Launch Services is unreliable about registering an app that
lives under `target/`.

## Tech stack

- **Tauri 2** — Rust shell + system webview (WebKit on macOS/Linux, WebView2 on Windows)
- **React 19** — UI framework
- **TypeScript** — renderer type safety
- **Vite 5** — build tooling and dev server
- **Vitest** — unit tests; **webdriverio + tauri-driver** — E2E

## Release process

Releases are built and published by GitHub Actions
(`.github/workflows/release.yml`). Pushing a version tag triggers the
workflow: tests, then a macOS/Windows/Linux matrix via `tauri-action`.
macOS builds are a signed + notarized universal binary (with a codesign
verification step); Windows ships an unsigned NSIS installer; Linux gets
AppImage, deb, and a pacman package wrapped from the deb
(`scripts/build-pacman.sh`). The updater manifest (`latest.json`) is
merged across platforms onto the release.

To release: `make release` (bumps `package.json` — the single version
source, `tauri.conf.json` reads it — commits, tags, pushes).

Nightlies (`.github/workflows/nightly.yml`) run daily, on pushes to
`nightly`, and on manual dispatch, producing dated pre-releases; the
rolling `nightly` release carries the updater manifest for that channel.

### Required GitHub Actions secrets

| Secret                               | Purpose                                      |
| ------------------------------------ | -------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Updater artifact signing (minisign)          |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for that key (empty string)         |
| `MAC_CERTIFICATE_BASE64`             | Base64-encoded .p12 Developer ID certificate |
| `MAC_CERTIFICATE_PASSWORD`           | Password for the .p12 file                   |
| `APPLE_ID`                           | Apple ID email for notarization              |
| `APPLE_APP_SPECIFIC_PASSWORD`        | App-specific password for notarization       |
| `APPLE_TEAM_ID`                      | Apple Developer Team ID                      |

`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` must be _set_ even when the key has no
password — set it to an empty string. Leaving it unset is not equivalent:
the CLI stops and waits on an interactive prompt, logging "Decrypting
updater signing key, expect a prompt for password". In CI that reads as a
hang, not an error.

`GITHUB_TOKEN` is provided automatically. If macOS secrets are missing the
build still succeeds but ships unsigned; if the updater key is missing,
bundling fails (build with `--no-sign` locally instead).

### Auto-updates

`tauri-plugin-updater` with a prompted flow — the app asks before
downloading (Install / Remind Me Later / Skip This Version), shows
progress on the dock/taskbar, and restores open files after the update
restart. See `docs/architecture.md` and `src-tauri/src/update.rs`.
