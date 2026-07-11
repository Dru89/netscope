.PHONY: dev build package test test-watch lint format clean icons release site-dev site-build

# Start the app in dev mode (Vite dev server + Tauri shell with hot reload).
dev:
	npm run dev

# Type-check and bundle the renderer (no packaging).
build:
	npm run build:vite

# Full production build: bundle + Tauri packaging for the current platform.
package:
	npm run build

# Run all tests (single run): renderer unit tests + Rust shell tests.
test:
	npm test
	cargo test --manifest-path src-tauri/Cargo.toml

# Run renderer tests in watch mode.
test-watch:
	npm run test:watch

# Type-check only (no emit).
lint:
	npx tsc --noEmit

# Format all files with Prettier.
format:
	npm run format

# Remove build artifacts.
clean:
	rm -rf dist src-tauri/target/release/bundle

# Regenerate platform icons from the source image (images/netscope.png).
# The Tauri CLI produces every size the bundler needs in src-tauri/icons/.
icons:
	npx tauri icon images/netscope.png

# Release: bump version, commit, tag, and push. GitHub Actions handles the
# rest. tauri.conf.json reads its version from package.json, so bumping one
# file versions the whole app.
#
# Usage:
#   make release                  # interactive prompt
#   make release VERSION=patch    # patch bump (1.2.3 → 1.2.4)
#   make release VERSION=minor    # minor bump (1.2.3 → 1.3.0)
#   make release VERSION=major    # major bump (1.2.3 → 2.0.0)
#   make release VERSION=2.1.0   # explicit version
release:
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "Error: You have uncommitted changes. Please commit or stash them first."; \
		exit 1; \
	fi; \
	CURRENT=$$(node -p "require('./package.json').version"); \
	MAJOR=$$(echo $$CURRENT | cut -d. -f1); \
	MINOR=$$(echo $$CURRENT | cut -d. -f2); \
	PATCH=$$(echo $$CURRENT | cut -d. -f3); \
	NEXT_PATCH="$$MAJOR.$$MINOR.$$((PATCH + 1))"; \
	NEXT_MINOR="$$MAJOR.$$((MINOR + 1)).0"; \
	NEXT_MAJOR="$$((MAJOR + 1)).0.0"; \
	if [ -n "$(VERSION)" ]; then \
		case "$(VERSION)" in \
			patch) NEXT=$$NEXT_PATCH ;; \
			minor) NEXT=$$NEXT_MINOR ;; \
			major) NEXT=$$NEXT_MAJOR ;; \
			*) NEXT="$(VERSION)" ;; \
		esac; \
	else \
		echo "Current version: v$$CURRENT"; \
		echo ""; \
		echo "  1) patch  → v$$NEXT_PATCH"; \
		echo "  2) minor  → v$$NEXT_MINOR"; \
		echo "  3) major  → v$$NEXT_MAJOR"; \
		echo "  4) custom"; \
		echo ""; \
		printf "Choice [1]: "; \
		read CHOICE; \
		CHOICE=$${CHOICE:-1}; \
		case $$CHOICE in \
			1) NEXT=$$NEXT_PATCH ;; \
			2) NEXT=$$NEXT_MINOR ;; \
			3) NEXT=$$NEXT_MAJOR ;; \
			4) printf "Version (without v prefix): "; read NEXT ;; \
			*) echo "Invalid choice"; exit 1 ;; \
		esac; \
	fi; \
	echo ""; \
	echo "Releasing v$$NEXT..."; \
	echo ""; \
	npm version $$NEXT --no-git-tag-version && \
	npm install --package-lock-only && \
	git add package.json package-lock.json && \
	git commit -m "Bump version to $$NEXT" && \
	git tag "v$$NEXT" && \
	git push origin main && \
	git push origin "v$$NEXT"; \
	echo ""; \
	echo "Tagged and pushed v$$NEXT. GitHub Actions will handle the rest."; \
	echo "https://github.com/Dru89/netscope/actions"

# Start the marketing site dev server.
site-dev:
	npm run site:dev

# Build the marketing site.
site-build:
	npm run site:build
