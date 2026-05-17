#!/usr/bin/env bash
# scripts/vendor-device-stream.sh
# Phase 17 Plan 17-06 — refresh vendored @device-stream/* tarballs.
#
# Usage:
#   ./scripts/vendor-device-stream.sh [path-to-device-stream-checkout]
#
# Defaults to ../device-stream (sibling repo convention).
#
# What it does:
#   1. For each package in (core, android, ios-simulator):
#      a. cd into <device-stream>/packages/<pkg>
#      b. npm install (if node_modules not present) && npm run build (if a build script exists)
#      c. npm pack (produces device-stream-<pkg>-<version>.tgz in current dir)
#      d. Move + rename to vendor/device-stream/<pkg>-<version>.tgz
#   2. Reports the new filenames so package.json `file:./vendor/device-stream/<pkg>-<version>.tgz`
#      references can be updated if versions changed.
#
# Verification after running:
#   rm -rf node_modules package-lock.json && npm install   # must succeed
#   grep -q 'file:\.\./device-stream' package.json          # must return non-zero
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="${1:-$REPO_ROOT/../device-stream}"
VENDOR_DIR="$REPO_ROOT/vendor/device-stream"
PACKAGES=(core android ios-simulator)

if [ ! -d "$SOURCE_DIR" ]; then
  echo "✗ device-stream source not found at $SOURCE_DIR" >&2
  echo "  Pass a custom path as argument: ./scripts/vendor-device-stream.sh /abs/path/to/device-stream" >&2
  exit 1
fi

mkdir -p "$VENDOR_DIR"

# Clean out old tarballs (filename-based — don't leak stale versions)
echo "→ Removing any stale *.tgz files in $VENDOR_DIR"
find "$VENDOR_DIR" -maxdepth 1 -name '*.tgz' -print -delete || true

for pkg in "${PACKAGES[@]}"; do
  PKG_DIR="$SOURCE_DIR/packages/$pkg"
  if [ ! -d "$PKG_DIR" ]; then
    echo "✗ missing package directory: $PKG_DIR" >&2
    exit 1
  fi

  echo ""
  echo "→ Packing @device-stream/$pkg from $PKG_DIR"
  pushd "$PKG_DIR" > /dev/null
  if [ -d "node_modules" ]; then
    echo "  (node_modules already present — skipping npm install)"
  else
    npm install --no-audit --no-fund
  fi
  # Build if a build script exists
  if node -e "process.exit(require('./package.json').scripts && require('./package.json').scripts.build ? 0 : 1)"; then
    npm run build
  fi
  TARBALL="$(npm pack --silent 2>&1 | tail -1)"
  VERSION="$(node -e "console.log(require('./package.json').version)")"
  popd > /dev/null

  DEST="$VENDOR_DIR/${pkg}-${VERSION}.tgz"
  mv "$PKG_DIR/$TARBALL" "$DEST"
  echo "  ✓ wrote $DEST"
done

echo ""
echo "✓ All 3 packages vendored to $VENDOR_DIR"
echo ""
echo "Next steps:"
echo "  1. Update package.json @device-stream/* refs to point at the new tarball filenames if versions changed"
echo "  2. rm -rf node_modules package-lock.json && npm install"
echo "  3. Commit vendor/device-stream/*.tgz + package.json + package-lock.json"
