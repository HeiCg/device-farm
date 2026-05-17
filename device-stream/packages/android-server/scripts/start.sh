#!/usr/bin/env bash
set -euo pipefail

# Start the Android Device Server (TCP JSON-RPC) on a connected device.
#
# Usage:
#   npm run start                    # uses first connected device
#   npm run start -- emulator-5554   # specific device
#
# Connect via TCP:
#   echo '{"jsonrpc":"2.0","method":"ping","id":1}' | nc localhost 9008

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NATIVE_DIR="$(cd "$PACKAGE_DIR/../../native-servers/android-device-server" && pwd)"
PORT="${DEVICE_SERVER_PORT:-9008}"

APP_APK=$(find "$NATIVE_DIR/build" -name "*-debug.apk" -not -name "*androidTest*" 2>/dev/null | head -1)
TEST_APK=$(find "$NATIVE_DIR/build" -name "*-androidTest.apk" 2>/dev/null | head -1)

# Check APKs exist
if [[ -z "$APP_APK" || -z "$TEST_APK" ]]; then
  echo "APKs not found. Building first..."
  bash "$SCRIPT_DIR/build.sh"
  APP_APK=$(find "$NATIVE_DIR/build" -name "*-debug.apk" -not -name "*androidTest*" 2>/dev/null | head -1)
  TEST_APK=$(find "$NATIVE_DIR/build" -name "*-androidTest.apk" 2>/dev/null | head -1)
fi

# Determine device serial
if [ -n "${1:-}" ]; then
  SERIAL="$1"
else
  SERIAL=$(adb devices | grep -w 'device' | head -1 | awk '{print $1}')
  if [ -z "$SERIAL" ]; then
    echo "Error: No Android device connected"
    exit 1
  fi
fi

echo "=== @device-stream/android-server (TCP JSON-RPC) ==="
echo "Device: $SERIAL"
echo "Port:   $PORT"
echo ""

# Install
echo "Installing APKs..."
adb -s "$SERIAL" install -r -t "$APP_APK" 2>/dev/null || true
adb -s "$SERIAL" install -r -t "$TEST_APK" 2>/dev/null || true

# Port forward
echo "Setting up port forward (tcp:$PORT -> tcp:$PORT)..."
adb -s "$SERIAL" forward "tcp:$PORT" "tcp:$PORT"

echo ""
echo "Server: tcp://localhost:$PORT (JSON-RPC 2.0, newline-delimited)"
echo "Test:   echo '{\"jsonrpc\":\"2.0\",\"method\":\"ping\",\"id\":1}' | nc localhost $PORT"
echo ""
echo "Press Ctrl+C to stop"
echo "---"

adb -s "$SERIAL" shell am instrument -w \
  -e class com.devicestream.server.DeviceServerTest \
  -e port "$PORT" \
  com.devicestream.server.test/androidx.test.runner.AndroidJUnitRunner
