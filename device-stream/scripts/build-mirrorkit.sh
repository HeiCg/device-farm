#!/bin/bash
# Build sim-capture — ScreenCaptureKit Swift binary for iOS Simulator streaming

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SIM_CAPTURE_DIR="${PROJECT_DIR}/tools/sim-capture"

echo "Building sim-capture..."

if [ ! -d "${SIM_CAPTURE_DIR}" ]; then
    echo "Error: sim-capture source not found at ${SIM_CAPTURE_DIR}"
    exit 1
fi

# Check for Swift
if ! command -v swift &> /dev/null; then
    echo "Error: Swift not found. Please install Xcode or Swift toolchain."
    exit 1
fi

cd "${SIM_CAPTURE_DIR}"

# Build release binary
swift build -c release

BUILD_PATH="${SIM_CAPTURE_DIR}/.build/release/sim-capture"

if [ -f "${BUILD_PATH}" ]; then
    echo ""
    echo "sim-capture built successfully!"
    echo "  Location: ${BUILD_PATH}"
    echo ""
    echo "Usage:"
    echo "  ${BUILD_PATH} --udid <SIMULATOR_UDID> --fps 30 --quality 80 --scale 1"
else
    echo "Error: Build output not found at ${BUILD_PATH}"
    exit 1
fi
