#!/usr/bin/env bash
# Smoke: probe + capture 30 frames + clean teardown against a real iOS simulator.
# Usage: smoke-sim-private.sh <UDID>
#
# Phase 32 Plan 32-05 (T-32.7) — replaces the Wave 0 stub.
# Exits 0 with "SMOKE: OK" on stdout when the full pipeline works.
set -euo pipefail

UDID="${1:-}"
if [[ -z "$UDID" ]]; then
  echo "usage: smoke-sim-private.sh <UDID>" >&2
  exit 64
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVICE_STREAM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$DEVICE_STREAM_DIR/bin/sim-capture-private"
UDID_LOWER="$(echo "$UDID" | tr '[:upper:]' '[:lower:]')"
SOCK="/tmp/device-stream-sim-${UDID_LOWER}.sock"
TMPLOG="$(mktemp -t smoke-sim-private.XXXXXX.log)"

if [[ ! -x "$BIN" ]]; then
  echo "smoke: binary not built at $BIN — run device-stream/scripts/build-sim-capture-private.sh" >&2
  exit 1
fi

# 1) probe — verify 8/8 symbols resolved on this Xcode
if ! "$BIN" --probe "$UDID" 2>"$TMPLOG" | grep -qE "^OK: 8/8 symbols resolved$"; then
  echo "smoke: probe failed for $UDID" >&2
  cat "$TMPLOG" >&2 || true
  exit 2
fi

# 2) ensure simulator is booted (idempotent — boot is a no-op when already booted)
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b
sleep 2

# 3) spawn daemon
rm -f "$SOCK"
"$BIN" --udid "$UDID" --socket "$SOCK" 2>"$TMPLOG" &
DAEMON_PID=$!
trap 'kill "$DAEMON_PID" 2>/dev/null || true; rm -f "$SOCK" "$TMPLOG"' EXIT

# Wait up to 5s for the socket to appear
for _ in {1..50}; do
  test -S "$SOCK" && break
  sleep 0.1
done
if ! test -S "$SOCK"; then
  echo "smoke: socket never appeared at $SOCK within 5s" >&2
  cat "$TMPLOG" >&2 || true
  exit 3
fi

# 4) read 30 frames via nc -U; count [u32 BE length][u8 kind][payload] frames.
#    Allow up to 30s for warm-up + steady-state at 30fps.
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
        frames += 1
        buf = buf[4 + length:]
sys.exit(0 if frames >= 30 else 'smoke: only ' + str(frames) + ' frames read')
" ) &
READER_PID=$!

# Give the reader up to 30s
READER_OK=0
for _ in {1..300}; do
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
  cat "$TMPLOG" >&2 || true
  exit 4
fi

# 5) clean shutdown — send 0xC9 quit frame, then SIGTERM the daemon.
printf '\x00\x00\x00\x01\xc9' | nc -U "$SOCK" -q 1 2>/dev/null || true
kill "$DAEMON_PID" 2>/dev/null || true
wait "$DAEMON_PID" 2>/dev/null || true

echo "SMOKE: OK"
exit 0
