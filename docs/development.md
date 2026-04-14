# Development

## Getting started

```bash
# Install dependencies
npm install

# Run in development mode (hot reload)
npm run dev

# Type-check and bundle (no packaging)
npm run build:vite

# Build the packaged app for your platform (unsigned)
npm run build

# Run tests
npm test
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server + Electron with hot reload |
| `npm run build` | Type-check, bundle, and package the app with electron-builder |
| `npm run build:vite` | Type-check and bundle only (no electron-builder packaging) |
| `npm test` | Run tests with Vitest |

## Tech stack

- **Electron 28** -- Cross-platform desktop runtime
- **React 18** -- UI framework
- **TypeScript 5** -- Type safety
- **Vite 5** -- Build tooling and dev server
- **electron-builder** -- Packaging and distribution

## Release process

Releases are built and published by GitHub Actions (`.github/workflows/release.yml`). Pushing a version tag triggers the workflow, which runs tests, builds for macOS, Windows, and Linux in parallel, and uploads all artifacts to a GitHub Release. macOS builds are code-signed and notarized when the required secrets are configured.

To release a new version:

1. Bump `version` in `package.json` and run `npm install --package-lock-only`
2. Commit: `git commit -am "Bump version to X.Y.Z"`
3. Tag: `git tag vX.Y.Z`
4. Push: `git push origin main && git push origin vX.Y.Z`

### Required GitHub Actions secrets

| Secret | Purpose |
|---|---|
| `MAC_CERTIFICATE_BASE64` | Base64-encoded .p12 Developer ID certificate |
| `MAC_CERTIFICATE_PASSWORD` | Password for the .p12 file |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

`GITHUB_TOKEN` is provided automatically by Actions. If any macOS secrets are missing, the build still succeeds but produces unsigned/un-notarized artifacts.

See `.env.example` for the credentials needed for local macOS signing/notarization.

### Auto-updates

`electron-updater` is configured with the `github` provider. On each platform, it looks for the matching `latest-*.yml` manifest in GitHub Releases and downloads updates silently. Updates install on next app quit.
