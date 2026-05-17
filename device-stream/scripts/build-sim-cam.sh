#!/usr/bin/env bash
set -euo pipefail

# Build sim-cam Swift CLI binary and stage it into device-stream/bin/.
# Requires Xcode (not just CommandLineTools) for AVFoundation headers.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR/tools/sim-cam"
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build -c release
mkdir -p "$ROOT_DIR/bin"
cp .build/release/sim-cam "$ROOT_DIR/bin/sim-cam"
echo "sim-cam binary staged at $ROOT_DIR/bin/sim-cam"
