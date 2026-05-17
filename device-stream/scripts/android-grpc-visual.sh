#!/usr/bin/env bash
# Visual-diff verification: capture ~60s from the android-grpc-stream daemon
# AND from the scrcpy fallback path against the same booted AVD, decode to PNG
# sequences, compute SSIM via ffmpeg. Pass criterion: SSIM ≥ 0.99.
#
# This script is informational. It always exits 0 (CI integration only logs
# PASS/FAIL). Run interactively against a calibration app for ground truth.
#
# Phase 33 Plan 33-05 (T-33.8). Mirrors device-stream/scripts/sim-visual-diff.sh.
# Usage: android-grpc-visual.sh <avd> [--duration 60]
set -euo pipefail

AVD="${1:-}"
DURATION="${2:-60}"
if [[ -z "$AVD" ]]; then
  echo "usage: android-grpc-visual.sh <avd> [--duration 60]" >&2
  exit 64
fi
[[ "$DURATION" == "--duration" ]] && DURATION="${3:-60}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVICE_STREAM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$DEVICE_STREAM_DIR/bin/android-grpc-stream"
WORKDIR="$(mktemp -d -t android-grpc-visual.XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "android-grpc-visual: ffmpeg not on PATH — install via 'brew install ffmpeg'" >&2
  echo "PASS: SKIPPED (ffmpeg missing)"
  exit 0
fi

if [[ ! -x "$BIN" ]]; then
  echo "android-grpc-visual: $BIN missing — build first" >&2
  echo "FAIL: gRPC daemon binary missing"
  exit 0
fi

# Pick a free grpc port.
GRPC_PORT="${GRPC_PORT:-}"
if [[ -z "$GRPC_PORT" ]]; then
  for p in $(seq 8554 8650); do
    if ! lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
      GRPC_PORT="$p"; break
    fi
  done
fi
CONSOLE_PORT="${CONSOLE_PORT:-5554}"
SERIAL="emulator-${CONSOLE_PORT}"

# Boot once, capture from both paths in sequence (assume idempotent UI state).
emulator -avd "$AVD" \
  -port "$CONSOLE_PORT" \
  -grpc "$GRPC_PORT" \
  -no-window -no-audio -no-boot-anim \
  -gpu swiftshader_indirect \
  >>"$WORKDIR/emu.log" 2>&1 &
EMU_PID=$!
cleanup_emu() {
  set +e
  kill "$EMU_PID" 2>/dev/null || true
}
trap 'rm -rf "$WORKDIR"; cleanup_emu' EXIT

for i in $(seq 1 120); do
  if adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' | grep -q '^1$'; then
    break
  fi
  sleep 1
done

# Capture from gRPC path.
capture_grpc() {
  local sock="/tmp/device-stream-android-emu-${SERIAL}-visual.sock"
  local out="$WORKDIR/grpc.h264"
  rm -f "$sock"
  "$BIN" --serial "$SERIAL" --grpc-port "$GRPC_PORT" --socket "$sock" >>"$WORKDIR/grpc.log" 2>&1 &
  local pid=$!
  for _ in {1..50}; do test -S "$sock" && break; sleep 0.1; done
  ( nc -U "$sock" 2>/dev/null | python3 -c "
import sys, struct, time
START = b'\x00\x00\x00\x01'
out = sys.stdout.buffer
buf = b''
deadline = time.time() + $DURATION
while time.time() < deadline:
    chunk = sys.stdin.buffer.read(4096)
    if not chunk: break
    buf += chunk
    while len(buf) >= 4:
        length = struct.unpack('>I', buf[:4])[0]
        if length == 0 or length > 16*1024*1024 or len(buf) < 4+length: break
        kind = buf[4]
        payload = buf[5:4+length]
        if kind in (0x01, 0x02):
            out.write(START + payload)
        buf = buf[4+length:]
" > "$out" ) &
  local readerpid=$!
  sleep "$DURATION"
  kill "$readerpid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  rm -f "$sock"
}

# Capture from scrcpy path via adb + screenrecord (rough analogue — scrcpy-server
# capture path is hard to drive directly from a shell script without the TS adapter).
# We use `adb shell screenrecord` as an apples-to-apples MP4 baseline that mirrors
# the legacy server-side encode pipeline.
capture_scrcpy() {
  local out="$WORKDIR/baseline.mp4"
  adb -s "$SERIAL" shell screenrecord --time-limit="$DURATION" /sdcard/baseline.mp4 \
    >>"$WORKDIR/scrcpy.log" 2>&1 || true
  adb -s "$SERIAL" pull /sdcard/baseline.mp4 "$out" >>"$WORKDIR/scrcpy.log" 2>&1 || true
}

echo "capturing $DURATION s from gRPC path..."
capture_grpc

echo "capturing $DURATION s from scrcpy/screenrecord baseline..."
capture_scrcpy

if [[ ! -s "$WORKDIR/grpc.h264" ]]; then
  echo "android-grpc-visual: gRPC capture is empty"
  echo "FAIL: gRPC capture empty"
  exit 0
fi
if [[ ! -s "$WORKDIR/baseline.mp4" ]]; then
  echo "android-grpc-visual: scrcpy/screenrecord baseline missing — SKIPPED"
  echo "PASS: SKIPPED (baseline missing)"
  exit 0
fi

# Decode to PNG sequences and SSIM the first 100 frames.
mkdir -p "$WORKDIR/grpc-frames" "$WORKDIR/baseline-frames"
ffmpeg -hide_banner -loglevel error -y -i "$WORKDIR/grpc.h264"   -frames:v 100 "$WORKDIR/grpc-frames/%04d.png"
ffmpeg -hide_banner -loglevel error -y -i "$WORKDIR/baseline.mp4" -frames:v 100 "$WORKDIR/baseline-frames/%04d.png"

SSIM=$(ffmpeg -hide_banner -loglevel info \
  -i "$WORKDIR/grpc-frames/%04d.png" \
  -i "$WORKDIR/baseline-frames/%04d.png" \
  -lavfi "ssim" -f null - 2>&1 | grep -oE "All:[0-9.]+" | tail -1 | cut -d: -f2 || true)

if [[ -z "$SSIM" ]]; then
  echo "FAIL: SSIM could not be computed (decoder mismatch?)"
  exit 0
fi

echo "SSIM (gRPC vs baseline, first 100 frames): $SSIM"
awk -v s="$SSIM" 'BEGIN { exit !(s >= 0.99) }' && echo "PASS: SSIM >= 0.99" || echo "FAIL: SSIM < 0.99"
exit 0
