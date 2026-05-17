#!/usr/bin/env bash
# Touch-latency verification: send 10 0xC1 touch frames through the daemon
# socket and measure touch_sent_ts → first AVCC AU received after the touch.
#
# Records median to stdout in ms. Always exits 0 (informational metric).
# Pass criterion (manual review): median ≤ 80 ms.
#
# Phase 33 Plan 33-05 (T-33.8). Mirrors device-stream/scripts/sim-touch-latency.sh.
# Usage: android-grpc-touch.sh <avd> [--samples 10]
set -euo pipefail

AVD="${1:-}"
SAMPLES="${2:-10}"
if [[ -z "$AVD" ]]; then
  echo "usage: android-grpc-touch.sh <avd> [--samples 10]" >&2
  exit 64
fi
[[ "$SAMPLES" == "--samples" ]] && SAMPLES="${3:-10}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVICE_STREAM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$DEVICE_STREAM_DIR/bin/android-grpc-stream"
TMPLOG="$(mktemp -t android-grpc-touch.XXXXXX.log)"

if [[ ! -x "$BIN" ]]; then
  echo "android-grpc-touch: $BIN missing — build first" >&2
  exit 0
fi

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
SOCK="/tmp/device-stream-android-emu-${SERIAL}-latency.sock"

cleanup() {
  set +e
  [[ -n "${DAEMON_PID:-}" ]] && kill "$DAEMON_PID" 2>/dev/null || true
  [[ -n "${EMU_PID:-}" ]] && kill "$EMU_PID" 2>/dev/null || true
  rm -f "$SOCK" "$TMPLOG"
}
trap cleanup EXIT INT TERM

emulator -avd "$AVD" \
  -port "$CONSOLE_PORT" \
  -grpc "$GRPC_PORT" \
  -no-window -no-audio -no-boot-anim \
  -gpu swiftshader_indirect \
  >>"$TMPLOG" 2>&1 &
EMU_PID=$!

for i in $(seq 1 120); do
  if adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' | grep -q '^1$'; then
    break
  fi
  sleep 1
done

rm -f "$SOCK"
"$BIN" --serial "$SERIAL" --grpc-port "$GRPC_PORT" --socket "$SOCK" >>"$TMPLOG" 2>&1 &
DAEMON_PID=$!

for _ in {1..50}; do test -S "$SOCK" && break; sleep 0.1; done
if ! test -S "$SOCK"; then
  echo "android-grpc-touch: socket never appeared" >&2
  tail -30 "$TMPLOG" >&2 || true
  exit 0
fi

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

# Warm-up
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
    sent_ns = time.monotonic_ns()
    send_touch(s, 0.5, 0.5, 0, 1.0, i)
    time.sleep(0.05)
    send_touch(s, 0.5, 0.5, 3, 0.0, i)
    recv_ns, buf = read_one_au_frame(buf, s)
    if recv_ns is None:
        print(f"sample {i}: timeout")
        continue
    deltas.append((recv_ns - sent_ns) / 1e6)
    time.sleep(0.3)

if deltas:
    median = statistics.median(deltas)
    print(f"samples: {len(deltas)}")
    print(f"median:  {median:.2f} ms")
    print(f"min:     {min(deltas):.2f} ms")
    print(f"max:     {max(deltas):.2f} ms")
    if median <= 80:
        print("PASS: median <= 80 ms")
    else:
        print(f"FAIL: median {median:.2f} ms > 80 ms")
else:
    print("no samples collected")
PY

exit 0
