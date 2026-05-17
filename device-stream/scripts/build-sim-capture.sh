#!/usr/bin/env bash
# Build the sim-capture-avcc Swift binary and stage it under
# device-stream/bin/. Requires Xcode (NOT just Command Line Tools) since the
# tool links against the private SimulatorKit + CoreSimulator frameworks.
#
# `xcode-select -p` is overridden via DEVELOPER_DIR so the build works even
# when the system xcode-select setting points at /Library/Developer/CommandLineTools.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVICE_STREAM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TOOL_DIR="$DEVICE_STREAM_DIR/tools/sim-capture-avcc"
OUT_DIR="$DEVICE_STREAM_DIR/bin"

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

mkdir -p "$OUT_DIR"

cd "$TOOL_DIR"
swift build -c release
cp ".build/release/sim-capture-avcc" "$OUT_DIR/sim-capture-avcc"
echo "built: $OUT_DIR/sim-capture-avcc"
