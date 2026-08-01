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

The Tauri CLI has no dotenv support, so **`make package` is what loads
`.env`** (`set -a` around a `.` of the file). A bare `npx tauri build`
reads nothing from it. Copy `.env.example` to `.env` and fill it in, or
export the variables yourself:

```bash
set -a; . ./.env; set +a
```

**The variable names are not the GitHub secret names.** Three of them
differ, and setting the secret name locally silently does nothing:

| Local variable               | GitHub secret                 |
| ---------------------------- | ----------------------------- |
| `APPLE_PASSWORD`             | `APPLE_APP_SPECIFIC_PASSWORD` |
| `APPLE_CERTIFICATE`          | `MAC_CERTIFICATE_BASE64`      |
| `APPLE_CERTIFICATE_PASSWORD` | `MAC_CERTIFICATE_PASSWORD`    |

Local signing is not a separate code path from CI. The Tauri CLI reads
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`
and the notarization variables itself, and does the keychain import itself
— `tauri-action` only supplies values. There are two ways to hand it the
certificate.

**From your login keychain** (what you want on your own Mac). Import the
`.p12` once by double-clicking it in Finder, then confirm it landed:

```bash
security find-identity -v -p codesigning
```

Set `APPLE_SIGNING_IDENTITY` to a substring of the certificate name that
matches exactly one identity. `Developer ID Application` is normally enough
and is what CI uses; if you ever hold two of them (renewal overlap does
this), codesign fails as ambiguous and you need the full
`Developer ID Application: Your Name (TEAMID)` or the SHA-1. Expired
`Apple Development` certificates in the list don't collide with it.
`tauri.conf.json` has no `signingIdentity` key, so this variable is the
only thing selecting the certificate. Then:

```bash
make package
```

**From a base64 blob, the way CI does it.** Set `APPLE_CERTIFICATE` to the
base64 of the `.p12` and `APPLE_CERTIFICATE_PASSWORD` to its export
password; the CLI builds a temporary keychain from them. CI has to work
this way because it has no login keychain. Locally it's worth knowing when
you're reproducing a CI signing failure, but it puts the `.p12` password in
a file on disk — prefer the keychain above for day-to-day work.

```bash
base64 -i certificate.p12 | pbcopy
```

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
