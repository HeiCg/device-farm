#!/usr/bin/env bash
# Build sim-input — Swift CLI ported from baguette for iOS-simulator HID
# input. Requires Xcode (not Command Line Tools) so SimulatorKit dlopen
# paths resolve; we set DEVELOPER_DIR explicitly so `xcode-select`'s
# global value doesn't matter.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

cd "$ROOT/tools/sim-input"
DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}" \
    swift build -c release

mkdir -p "$ROOT/bin"
cp .build/release/sim-input "$ROOT/bin/sim-input"
echo "built: $ROOT/bin/sim-input"
