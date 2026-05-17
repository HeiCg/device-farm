#!/usr/bin/env bash
# Soak (memory-leak detection): run android-grpc-stream against a booted AVD
# for the specified duration, sample RSS every 30s. Pass criterion: RSS growth
# ≤ 50 MB after a 5-minute warm-up window (or DURATION/6 if shorter).
#
# Phase 33 Plan 33-05 (T-33.8). Mirrors device-stream/scripts/sim-soak.sh.
# Usage: android-grpc-soak.sh <avd> [--duration 30m]
set -euo pipefail

AVD="${1:-}"
DURATION_ARG="${2:-30m}"
[[ "$DURATION_ARG" == "--duration" ]] && DURATION_ARG="${3:-30m}"

if [[ -z "$AVD" ]]; then
  echo "usage: android-grpc-soak.sh <avd> [--duration 30m]" >&2
  exit 64
fi

parse_seconds() {
  local v="$1"
  case "$v" in
    *h) echo $(( ${v%h} * 3600 )) ;;
    *m) echo $(( ${v%m} * 60 )) ;;
    *s) echo "${v%s}" ;;
    *)  echo "$v" ;;
  esac
}
DURATION_SEC=$(parse_seconds "$DURATION_ARG")
WARMUP_SEC=$(( DURATION_SEC < 600 ? DURATION_SEC / 6 : 300 ))
THRESHOLD_KB=$((50 * 1024))   # 50 MB

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVICE_STREAM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$DEVICE_STREAM_DIR/bin/android-grpc-stream"
TMPLOG="$(mktemp -t android-grpc-soak.XXXXXX.log)"
RSS_LOG="$(mktemp -t android-grpc-soak-rss.XXXXXX.csv)"

if [[ ! -x "$BIN" ]]; then
  echo "android-grpc-soak: $BIN missing — build first" >&2
  exit 1
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
SOCK="/tmp/device-stream-android-emu-${SERIAL}-soak.sock"

cleanup() {
  set +e
  [[ -n "${NC_PID:-}" ]] && kill "$NC_PID" 2>/dev/null || true
  [[ -n "${DAEMON_PID:-}" ]] && kill "$DAEMON_PID" 2>/dev/null || true
  [[ -n "${EMU_PID:-}" ]] && kill "$EMU_PID" 2>/dev/null || true
  rm -f "$SOCK" "$TMPLOG"
}
trap cleanup EXIT INT TERM

echo "android-grpc-soak: booting $AVD on console=$CONSOLE_PORT grpc=$GRPC_PORT (duration ${DURATION_SEC}s)"
emulator -avd "$AVD" \
  -port "$CONSOLE_PORT" \
  -grpc "$GRPC_PORT" \
  -no-window -no-audio -no-boot-anim \
  -gpu swiftshader_indirect \
  >>"$TMPLOG" 2>&1 &
EMU_PID=$!

# Wait for boot.
for i in $(seq 1 120); do
  if adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' | grep -q '^1$'; then
    break
  fi
  sleep 1
done

# Spawn daemon.
rm -f "$SOCK"
"$BIN" --serial "$SERIAL" --grpc-port "$GRPC_PORT" --socket "$SOCK" >>"$TMPLOG" 2>&1 &
DAEMON_PID=$!

for _ in {1..50}; do test -S "$SOCK" && break; sleep 0.1; done
if ! test -S "$SOCK"; then
  echo "android-grpc-soak: socket never appeared" >&2
  tail -30 "$TMPLOG" >&2 || true
  exit 1
fi

# Keep a consumer attached so the daemon emits frames continuously.
( nc -U "$SOCK" >/dev/null 2>&1 ) &
NC_PID=$!

echo "ts_sec,rss_kb" > "$RSS_LOG"

START_TS=$(date +%s)
END_TS=$(( START_TS + DURATION_SEC ))
WARMUP_END_TS=$(( START_TS + WARMUP_SEC ))
WARMUP_RSS=""
MAX_RSS=0

while [[ $(date +%s) -lt $END_TS ]]; do
  RSS=$(ps -o rss= -p "$DAEMON_PID" 2>/dev/null | awk '{print $1}')
  if [[ -z "$RSS" ]]; then
    echo "android-grpc-soak: daemon exited prematurely (pid $DAEMON_PID gone)" >&2
    tail -30 "$TMPLOG" >&2 || true
    exit 1
  fi
  NOW=$(date +%s)
  echo "$((NOW - START_TS)),$RSS" >> "$RSS_LOG"
  if [[ "$NOW" -ge "$WARMUP_END_TS" && -z "$WARMUP_RSS" ]]; then
    WARMUP_RSS="$RSS"
    echo "warm-up complete at +${WARMUP_SEC}s; baseline RSS = ${WARMUP_RSS} KB"
  fi
  if [[ "$RSS" -gt "$MAX_RSS" ]]; then MAX_RSS="$RSS"; fi
  sleep 30
done

echo "--- RSS samples (ts_sec,rss_kb) ---"
cat "$RSS_LOG"

if [[ -n "$WARMUP_RSS" ]]; then
  GROWTH=$(( MAX_RSS - WARMUP_RSS ))
  echo "RSS growth post-warm-up: ${GROWTH} KB (threshold: ${THRESHOLD_KB} KB)"
  if [[ "$GROWTH" -gt "$THRESHOLD_KB" ]]; then
    echo "FAIL: RSS grew ${GROWTH} KB > ${THRESHOLD_KB} KB"
    exit 1
  fi
  echo "PASS: RSS growth within threshold"
fi

exit 0
