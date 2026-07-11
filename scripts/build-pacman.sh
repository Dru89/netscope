#!/usr/bin/env bash
# Build an Arch Linux pacman package from the Tauri .deb output.
#
# Tauri's bundler has no pacman target, but Arch can't run the AppImage out
# of the box (no FUSE 2), so we ship a real pacman package: the .deb's file
# tree re-wrapped with a .PKGINFO and .MTREE via bsdtar — the same approach
# electron-builder's pacman target used. Requires: bsdtar (libarchive-tools),
# zstd.
#
# Usage: scripts/build-pacman.sh <path-to.deb> <version> <out-dir>
set -euo pipefail

DEB="$1"
VERSION="$2"
# Resolve to an absolute path up front — the packaging happens after a cd
# into a temp dir, so a relative out-dir would vanish with the temp tree.
mkdir -p "$3"
OUT_DIR="$(realpath "$3")"

# pacman versions use _ instead of - (e.g. 4.0.0-nightly.x → 4.0.0_nightly.x)
PKGVER="${VERSION//-/_}"
PKGNAME="netscope"
ARCH="x86_64"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Extract the deb's payload (usr/ tree)
bsdtar -xf "$DEB" -C "$WORK" data.tar.gz
mkdir -p "$WORK/root"
bsdtar -xf "$WORK/data.tar.gz" -C "$WORK/root"
rm "$WORK/data.tar.gz"

INSTALLED_SIZE=$(du -sb "$WORK/root" | cut -f1)

cat > "$WORK/root/.PKGINFO" <<EOF
pkgname = $PKGNAME
pkgbase = $PKGNAME
pkgver = $PKGVER-1
pkgdesc = A desktop app for viewing and exploring HAR files
url = https://netscopeapp.com
builddate = $(date -u +%s)
packager = Netscope CI <drew@hays.fm>
size = $INSTALLED_SIZE
arch = $ARCH
license = MIT
depend = webkit2gtk-4.1
depend = gtk3
depend = hicolor-icon-theme
EOF

cd "$WORK/root"

# .MTREE manifest (metadata pacman uses for integrity checks)
LANG=C bsdtar -czf .MTREE --format=mtree \
  --options='!all,use-set,type,uid,gid,mode,time,size,md5,sha256,link' \
  .PKGINFO usr

PKGFILE="$OUT_DIR/${PKGNAME}-${PKGVER}-1-${ARCH}.pkg.tar.zst"
LANG=C bsdtar -cf - .PKGINFO .MTREE usr | zstd -19 -o "$PKGFILE"

echo "Built $PKGFILE"
