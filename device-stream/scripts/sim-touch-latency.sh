#!/usr/bin/env bash
# Touch-latency verification (SIM-PRIV-04): send 10 0xC1 touch frames through
# the daemon and measure touch_sent_ts → first_frame_after_touch delta.
#
# Records median to stdout in ms. Always exits 0 (informational metric).
# Run interactively against a calibration app whose UI flashes on tap for a
# visually-detectable response window.
#
# Phase 32 Plan 32-05 (T-32.7).
# Usage: sim-touch-latency.sh <UDID> [--samples 10]
set -euo pipefail

UDID="${1:-}"
SAMPLES="${2:-10}"
if [[ -z "$UDID" ]]; then
  echo "usage: sim-touch-latency.sh <UDID> [--samples 10]" >&2
  exit 64
fi
[[ "$SAMPLES" == "--samples" ]] && SAMPLES="${3:-10}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVICE_STREAM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$DEVICE_STREAM_DIR/bin/sim-capture-private"
SOCK="/tmp/device-stream-sim-${UDID,,}-latency.sock"
TMPLOG="$(mktemp -t sim-touch-latency.XXXXXX.log)"

if [[ ! -x "$BIN" ]]; then
  echo "sim-touch-latency: $BIN missing — build first" >&2
  exit 0
fi

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b
sleep 1

rm -f "$SOCK"
"$BIN" --udid "$UDID" --socket "$SOCK" 2>"$TMPLOG" &
DAEMON_PID=$!
trap 'kill "$DAEMON_PID" 2>/dev/null || true; rm -f "$SOCK" "$TMPLOG"' EXIT

for _ in {1..50}; do test -S "$SOCK" && break; sleep 0.1; done
if ! test -S "$SOCK"; then
  echo "sim-touch-latency: socket never appeared" >&2
  cat "$TMPLOG" >&2 || true
  exit 0
fi

# Send N touches with timing measurement. Each touch:
#   - record send time (ns)
#   - read frames until the next 0x02 AU arrives → record receive time
#   - delta_ms = (receive - send) / 1e6
python3 - <<PY
import socket, struct, time, statistics

SOCK = "$SOCK"
SAMPLES = int("$SAMPLES")

def send_touch(s, x, y, phase, pressure, tid):
    # 34-byte 0xC1 frame: [u32 BE length=30][0xC1][f64 BE x][f64 BE y][u8 phase][f64 BE pressure][u32 BE tid]
    payload = struct.pack(">dd", x, y) + bytes([phase]) + struct.pack(">d", pressure) + struct.pack(">I", tid)
    frame = struct.pack(">IB", 30, 0xC1) + payload
    s.sendall(frame)

def read_one_au_frame(buf, sock, timeout=2.0):
    sock.settimeout(timeout)
    while True:
        while len(buf) >= 4:
            length = struct.unpack(">I", buf[:4])[0]
            if length == 0 or length > 16*1024*1024:
                return None, buf
            if len(buf) < 4 + length:
                break
            kind = buf[4]
            buf = buf[4+length:]
            if kind == 0x02:
                return time.monotonic_ns(), buf
        try:
            chunk = sock.recv(4096)
        except socket.timeout:
            return None, buf
        if not chunk:
            return None, buf
        buf += chunk

s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(SOCK)

# Warm-up: drain the first few frames so we have a steady-state baseline.
buf = b""
warm_deadline = time.monotonic() + 2.0
while time.monotonic() < warm_deadline:
    try:
        s.settimeout(0.1)
        chunk = s.recv(4096)
        if not chunk: break
        buf += chunk
    except socket.timeout:
        break

deltas = []
for i in range(SAMPLES):
    # Tap roughly centered (ratio coords)
    sent_ns = time.monotonic_ns()
    send_touch(s, 0.5, 0.5, 0, 1.0, i)
    # Drop phase
    time.sleep(0.05)
    send_touch(s, 0.5, 0.5, 3, 0.0, i)
    recv_ns, buf = read_one_au_frame(buf, s)
    if recv_ns is None:
        print(f"sample {i}: timeout")
        continue
    deltas.append((recv_ns - sent_ns) / 1e6)
    time.sleep(0.3)

if deltas:
    print(f"samples: {len(deltas)}")
    print(f"median: {statistics.median(deltas):.2f} ms")
    print(f"min:    {min(deltas):.2f} ms")
    print(f"max:    {max(deltas):.2f} ms")
else:
    print("no samples collected")
PY

exit 0
