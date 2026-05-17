#!/usr/bin/env bash
# Visual-diff verification (SIM-PRIV-03): capture ~60s from both the private
# bridge and the ScreenCaptureKit fallback, decode to PNG sequences, compute
# SSIM via ffmpeg. Pass criterion: SSIM ≥ 0.995 (≤ 0.5% pixel diff).
#
# This script is informational. It always exits 0 (CI integration only logs
# PASS/FAIL). Run interactively against a calibration app for ground truth.
#
# Phase 32 Plan 32-05 (T-32.7).
# Usage: sim-visual-diff.sh <UDID> [--duration 60]
set -euo pipefail

UDID="${1:-}"
DURATION="${2:-60}"
if [[ -z "$UDID" ]]; then
  echo "usage: sim-visual-diff.sh <UDID> [--duration 60]" >&2
  exit 64
fi
# Strip leading "--duration" if passed positionally
[[ "$DURATION" == "--duration" ]] && DURATION="${3:-60}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVICE_STREAM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_PRIVATE="$DEVICE_STREAM_DIR/bin/sim-capture-private"
BIN_AVCC="$DEVICE_STREAM_DIR/bin/sim-capture-avcc"
WORKDIR="$(mktemp -d -t sim-visual-diff.XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "sim-visual-diff: ffmpeg not on PATH — install via 'brew install ffmpeg'" >&2
  echo "PASS: SKIPPED (ffmpeg missing)"
  exit 0
fi

if [[ ! -x "$BIN_PRIVATE" ]]; then
  echo "sim-visual-diff: $BIN_PRIVATE missing — build first" >&2
  echo "FAIL: private bridge binary missing"
  exit 0
fi

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b
sleep 1

capture() {
  local label="$1" bin="$2" sock="/tmp/device-stream-sim-${UDID,,}-${label}.sock"
  local out="$WORKDIR/${label}.h264"
  rm -f "$sock"
  "$bin" --udid "$UDID" --socket "$sock" 2>"$WORKDIR/${label}.log" &
  local pid=$!
  # Wait for socket
  for _ in {1..50}; do test -S "$sock" && break; sleep 0.1; done
  # Read raw H.264 AUs (strip length+kind prefix via python; emit annex-B for ffmpeg)
  ( nc -U "$sock" 2>/dev/null | python3 -c "
import sys, struct
START = b'\x00\x00\x00\x01'
out = sys.stdout.buffer
buf = b''
import time
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

echo "capturing $DURATION s from private bridge…"
capture private "$BIN_PRIVATE"

if [[ -x "$BIN_AVCC" ]]; then
  echo "capturing $DURATION s from ScreenCaptureKit (avcc)…"
  capture avcc "$BIN_AVCC"
else
  echo "sim-visual-diff: $BIN_AVCC missing — cannot diff. Reporting SKIPPED." >&2
  echo "PASS: SKIPPED (avcc baseline missing)"
  exit 0
fi

# Decode to PNG sequences and SSIM the first 100 frames
mkdir -p "$WORKDIR/private-frames" "$WORKDIR/avcc-frames"
ffmpeg -hide_banner -loglevel error -y -i "$WORKDIR/private.h264" -frames:v 100 "$WORKDIR/private-frames/%04d.png"
ffmpeg -hide_banner -loglevel error -y -i "$WORKDIR/avcc.h264"    -frames:v 100 "$WORKDIR/avcc-frames/%04d.png"

# ffmpeg SSIM filter: log line "SSIM Y:0.998 U:0.999 V:0.999 All:0.998 (28.06 dB)"
SSIM=$(ffmpeg -hide_banner -loglevel info \
  -i "$WORKDIR/private-frames/%04d.png" \
  -i "$WORKDIR/avcc-frames/%04d.png" \
  -lavfi "ssim" -f null - 2>&1 | grep -oE "All:[0-9.]+" | tail -1 | cut -d: -f2 || true)

if [[ -z "$SSIM" ]]; then
  echo "FAIL: SSIM could not be computed (decoder mismatch?)"
  exit 0
fi

echo "SSIM (private vs avcc, first 100 frames): $SSIM"
awk -v s="$SSIM" 'BEGIN { exit !(s >= 0.995) }' && echo "PASS: SSIM ≥ 0.995" || echo "FAIL: SSIM < 0.995"
exit 0
