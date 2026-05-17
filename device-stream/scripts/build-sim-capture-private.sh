#!/usr/bin/env bash
# Build the sim-capture-private XcodeGen-based daemon and stage it at
# device-stream/bin/sim-capture-private. Requires:
#   - Xcode (NOT Command Line Tools alone) — for SimulatorKit + CoreSimulator
#   - xcodegen (brew install xcodegen)
#   - macOS 13+ on Apple Silicon
#
# Plan 32-04 (T-32.6) replaced the Wave-0 stub with a real build. The
# postinstall hook treats build failure as non-fatal (the TS adapter falls
# back to sim-capture-avcc at runtime when the daemon binary is missing).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVICE_STREAM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TOOL_DIR="$DEVICE_STREAM_DIR/native-servers/sim-capture-private"
OUT_DIR="$DEVICE_STREAM_DIR/bin"

# `xcode-select -p` is overridden via DEVELOPER_DIR so the build works even
# when the system xcode-select setting points at /Library/Developer/CommandLineTools.
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

if [[ ! -d "$DEVELOPER_DIR" ]]; then
  echo "build-sim-capture-private: DEVELOPER_DIR=$DEVELOPER_DIR not found; install Xcode or set DEVELOPER_DIR" >&2
  exit 1
fi

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "build-sim-capture-private: xcodegen not found (try: brew install xcodegen)" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

cd "$TOOL_DIR"
xcodegen generate

xcodebuild -project sim-capture-private.xcodeproj \
           -scheme sim-capture-private \
           -configuration Release \
           -derivedDataPath build \
           -quiet \
           build

BIN_SRC="build/Build/Products/Release/sim-capture-private"
if [[ ! -x "$BIN_SRC" ]]; then
  echo "build-sim-capture-private: expected output not found at $BIN_SRC" >&2
  exit 1
fi
cp "$BIN_SRC" "$OUT_DIR/sim-capture-private"
chmod +x "$OUT_DIR/sim-capture-private"

echo "built: $OUT_DIR/sim-capture-private"
