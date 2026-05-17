#!/usr/bin/env bash
# Smoke: probe + boot emulator + capture 30 frames + clean teardown against a
# real Android AVD. Usage: smoke-android-grpc.sh <avd>
#
# Phase 33 Plan 33-05 (T-33.8) — replaces the Wave 0 stub.
# Exits 0 with "SMOKE: OK" on stdout when the full pipeline works.
#
# Mirrors device-stream/scripts/smoke-sim-private.sh structurally:
#   1) bin check
#   2) pick free grpc port (8554..8650)
#   3) boot emulator headless
#   4) wait for sys.boot_completed
#   5) probe daemon
#   6) spawn daemon
#   7) read 30 frames via nc -U + python3 length-prefix framer
#   8) send 0xC9 quit + kill emulator
set -euo pipefail

AVD="${1:-}"
if [[ -z "$AVD" ]]; then
  echo "usage: smoke-android-grpc.sh <avd>" >&2
  exit 64
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVICE_STREAM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$DEVICE_STREAM_DIR/bin/android-grpc-stream"
TMPLOG="$(mktemp -t smoke-android-grpc.XXXXXX.log)"

if [[ ! -x "$BIN" ]]; then
  echo "smoke: binary not built at $BIN — run device-stream/scripts/build-android-grpc.sh" >&2
  exit 1
fi

# Pick a free gRPC port from the band 8554..8650.
GRPC_PORT="${GRPC_PORT:-}"
if [[ -z "$GRPC_PORT" ]]; then
  for p in $(seq 8554 8650); do
    if ! lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
      GRPC_PORT="$p"
      break
    fi
  done
fi
if [[ -z "$GRPC_PORT" ]]; then
  echo "smoke: no free gRPC port in band 8554-8650" >&2
  exit 1
fi

# Pick a console port (default 5554; adjust if taken).
CONSOLE_PORT="${CONSOLE_PORT:-5554}"
SERIAL="emulator-${CONSOLE_PORT}"
SOCK="/tmp/device-stream-android-emu-${SERIAL}-smoke.sock"

cleanup() {
  set +e
  # 0xC9 quit frame on the way out (best-effort)
  if [[ -S "$SOCK" ]]; then
    printf '\x00\x00\x00\x01\xc9' | nc -U "$SOCK" -q 1 2>/dev/null || true
  fi
  if [[ -n "${DAEMON_PID:-}" ]]; then
    kill "$DAEMON_PID" 2>/dev/null || true
  fi
  if [[ -n "${EMU_PID:-}" ]]; then
    kill "$EMU_PID" 2>/dev/null || true
    # Give the emulator a beat to shut down so the next smoke can reuse the port.
    for _ in {1..30}; do kill -0 "$EMU_PID" 2>/dev/null || break; sleep 0.1; done
    kill -9 "$EMU_PID" 2>/dev/null || true
  fi
  rm -f "$SOCK" "$TMPLOG"
}
trap cleanup EXIT INT TERM

# Boot emulator headless with -grpc <port>.
echo "smoke: booting $AVD on console=$CONSOLE_PORT grpc=$GRPC_PORT"
emulator -avd "$AVD" \
  -port "$CONSOLE_PORT" \
  -grpc "$GRPC_PORT" \
  -no-window -no-audio -no-boot-anim \
  -gpu swiftshader_indirect \
  >>"$TMPLOG" 2>&1 &
EMU_PID=$!

# Wait up to 120s for sys.boot_completed=1.
BOOTED=0
for i in $(seq 1 120); do
  if adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' | grep -q '^1$'; then
    BOOTED=1
    break
  fi
  sleep 1
done
if [[ "$BOOTED" -ne 1 ]]; then
  echo "smoke: emulator did not boot within 120s" >&2
  tail -50 "$TMPLOG" >&2 || true
  exit 2
fi

# Probe.
if ! "$BIN" --probe --serial "$SERIAL" --grpc-port "$GRPC_PORT" 2>>"$TMPLOG"; then
  echo "smoke: probe failed" >&2
  tail -30 "$TMPLOG" >&2 || true
  exit 3
fi

# Spawn daemon.
rm -f "$SOCK"
"$BIN" --serial "$SERIAL" --grpc-port "$GRPC_PORT" --socket "$SOCK" >>"$TMPLOG" 2>&1 &
DAEMON_PID=$!

# Wait up to 5s for socket.
for _ in {1..50}; do test -S "$SOCK" && break; sleep 0.1; done
if ! test -S "$SOCK"; then
  echo "smoke: socket never appeared at $SOCK" >&2
  tail -30 "$TMPLOG" >&2 || true
  exit 4
fi

# Read 30 frames via nc -U + python3 length-prefix framer (mirror Phase 32).
( nc -U "$SOCK" 2>/dev/null | python3 -c "
import sys, struct
buf = b''
frames = 0
while frames < 30:
    chunk = sys.stdin.buffer.read(4096)
    if not chunk:
        break
    buf += chunk
    while len(buf) >= 4:
        length = struct.unpack('>I', buf[:4])[0]
        if length == 0 or length > 16 * 1024 * 1024:
            sys.exit('smoke: invalid length ' + str(length))
        if len(buf) < 4 + length:
            break
        kind = buf[4]
        # Count only AVCC AUs (0x02). 0x01 SPS/PPS, 0x03 metadata are info-only.
        if kind == 0x02:
            frames += 1
        buf = buf[4 + length:]
sys.exit(0 if frames >= 30 else 'smoke: only ' + str(frames) + ' frames read')
" ) &
READER_PID=$!

READER_OK=0
for _ in {1..600}; do
  if ! kill -0 "$READER_PID" 2>/dev/null; then
    if wait "$READER_PID"; then
      READER_OK=1
    fi
    break
  fi
  sleep 0.1
done

if [[ "$READER_OK" -ne 1 ]]; then
  kill "$READER_PID" 2>/dev/null || true
  echo "smoke: failed to read 30 frames in time" >&2
  tail -30 "$TMPLOG" >&2 || true
  exit 5
fi

echo "SMOKE: OK"
exit 0
