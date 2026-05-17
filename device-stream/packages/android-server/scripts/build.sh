#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NATIVE_DIR="$(cd "$PACKAGE_DIR/../../native-servers/android-device-server" && pwd)"

echo "=== @device-stream/android-server build ==="

if [[ -z "${ANDROID_HOME:-}" ]]; then
  if [[ -d "$HOME/Library/Android/sdk" ]]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  else
    echo "ERROR: ANDROID_HOME is not set"
    exit 1
  fi
fi

cd "$NATIVE_DIR"
chmod +x gradlew 2>/dev/null || true

echo "Building app APK..."
./gradlew assembleDebug --quiet

echo "Building test APK (instrumentation server)..."
./gradlew assembleDebugAndroidTest --quiet

APP_APK="$NATIVE_DIR/build/outputs/apk/debug/android-device-server-debug.apk"
TEST_APK="$NATIVE_DIR/build/outputs/apk/androidTest/debug/android-device-server-debug-androidTest.apk"

if [[ -f "$APP_APK" && -f "$TEST_APK" ]]; then
  echo ""
  echo "Build successful!"
  echo "  App APK:  $APP_APK"
  echo "  Test APK: $TEST_APK"
else
  echo "ERROR: Build failed - APKs not found"
  echo "Looking for APKs in:"
  find "$NATIVE_DIR/build" -name "*.apk" 2>/dev/null || echo "  (no APKs found)"
  exit 1
fi
