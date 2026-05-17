#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NATIVE_DIR="$(cd "$PACKAGE_DIR/../../native-servers/android-device-server" && pwd)"

APP_APK=$(find "$NATIVE_DIR/build" -name "*-debug.apk" -not -name "*androidTest*" 2>/dev/null | head -1)
TEST_APK=$(find "$NATIVE_DIR/build" -name "*-androidTest.apk" 2>/dev/null | head -1)

if [[ -n "$APP_APK" && -n "$TEST_APK" ]]; then
  echo "APKs already built:"
  echo "  App:  $APP_APK"
  echo "  Test: $TEST_APK"
  exit 0
fi

echo "APKs not found, building..."
bash "$SCRIPT_DIR/build.sh"
