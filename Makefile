.PHONY: dev build package test test-watch lint clean icons release site-dev site-build

# Start the Vite dev server with Electron hot reload.
dev:
	npm run dev

# Type-check and bundle (no Electron packaging).
build:
	npx tsc && npx vite build

# Full production build: type-check, bundle, and package for the current platform.
package:
	npm run build

# Run all tests (single run).
test:
	npm test

# Run tests in watch mode.
test-watch:
	npm run test:watch

# Type-check only (no emit).
lint:
	npx tsc --noEmit

# Remove all build artifacts.
clean:
	rm -rf dist dist-electron release

# Regenerate platform icons from the source image (images/netscope.png).
# Requires ImageMagick (magick/convert) and macOS sips/iconutil.
icons: build/icon.icns build/icon.ico build/icon.png

build/icon.icns: images/netscope.png
	@mkdir -p /tmp/netscope-icon.iconset
	@sips -z 16 16     $< --out /tmp/netscope-icon.iconset/icon_16x16.png      >/dev/null
	@sips -z 32 32     $< --out /tmp/netscope-icon.iconset/icon_16x16@2x.png   >/dev/null
	@sips -z 32 32     $< --out /tmp/netscope-icon.iconset/icon_32x32.png      >/dev/null
	@sips -z 64 64     $< --out /tmp/netscope-icon.iconset/icon_32x32@2x.png   >/dev/null
	@sips -z 128 128   $< --out /tmp/netscope-icon.iconset/icon_128x128.png    >/dev/null
	@sips -z 256 256   $< --out /tmp/netscope-icon.iconset/icon_128x128@2x.png >/dev/null
	@sips -z 256 256   $< --out /tmp/netscope-icon.iconset/icon_256x256.png    >/dev/null
	@sips -z 512 512   $< --out /tmp/netscope-icon.iconset/icon_256x256@2x.png >/dev/null
	@sips -z 512 512   $< --out /tmp/netscope-icon.iconset/icon_512x512.png    >/dev/null
	@sips -z 1024 1024 $< --out /tmp/netscope-icon.iconset/icon_512x512@2x.png >/dev/null
	@iconutil -c icns /tmp/netscope-icon.iconset -o $@
	@rm -rf /tmp/netscope-icon.iconset
	@echo "Generated $@"

build/icon.ico: images/netscope.png
	@magick $< -resize 256x256 -define icon:auto-resize=256,128,64,48,32,16 $@
	@echo "Generated $@"

build/icon.png: images/netscope.png
	@sips -z 512 512 $< --out $@ >/dev/null
	@echo "Generated $@"

# Interactive release: prompts for version bump type, updates package.json,
# commits, tags, and pushes. GitHub Actions handles the rest.
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
		1) VERSION=$$NEXT_PATCH ;; \
		2) VERSION=$$NEXT_MINOR ;; \
		3) VERSION=$$NEXT_MAJOR ;; \
		4) printf "Version (without v prefix): "; read VERSION ;; \
		*) echo "Invalid choice"; exit 1 ;; \
	esac; \
	echo ""; \
	echo "Releasing v$$VERSION..."; \
	echo ""; \
	npm version $$VERSION --no-git-tag-version && \
	npm install --package-lock-only && \
	git add package.json package-lock.json && \
	git commit -m "Bump version to $$VERSION" && \
	git tag "v$$VERSION" && \
	git push origin main && \
	git push origin "v$$VERSION"; \
	echo ""; \
	echo "Tagged and pushed v$$VERSION. GitHub Actions will handle the rest."; \
	echo "https://github.com/Dru89/netscope/actions"

# Start the marketing site dev server.
site-dev:
	npm run site:dev

# Build the marketing site.
site-build:
	npm run site:build
