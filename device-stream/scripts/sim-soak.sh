#!/usr/bin/env bash
# Soak (memory-leak detection): run sim-capture-private for the specified
# duration, sample RSS every 60s, run `leaks <pid>` at the end.
#
# Pass criterion: RSS growth ≤ 50 MB after a 5-minute warm-up window.
# Exits 1 if RSS growth exceeds the threshold. Otherwise exits 0.
#
# Phase 32 Plan 32-05 (T-32.7).
# Usage: sim-soak.sh <UDID> [--duration 1h]
set -euo pipefail

UDID="${1:-}"
DURATION_ARG="${2:-1h}"
[[ "$DURATION_ARG" == "--duration" ]] && DURATION_ARG="${3:-1h}"

if [[ -z "$UDID" ]]; then
  echo "usage: sim-soak.sh <UDID> [--duration 1h]" >&2
  exit 64
fi

# Parse duration suffix (s|m|h)
parse_seconds() {
  local v="$1"
  case "$v" in
    *h) echo $(( ${v%h} * 3600 )) ;;
    *m) echo $(( ${v%m} * 60 )) ;;
    *s) echo "${v%s}" ;;
    *)  echo "$v" ;;  # raw seconds
  esac
}
DURATION_SEC=$(parse_seconds "$DURATION_ARG")
WARMUP_SEC=$(( DURATION_SEC < 600 ? DURATION_SEC / 6 : 300 ))
THRESHOLD_KB=$((50 * 1024))   # 50 MB

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVICE_STREAM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$DEVICE_STREAM_DIR/bin/sim-capture-private"
SOCK="/tmp/device-stream-sim-${UDID,,}-soak.sock"
TMPLOG="$(mktemp -t sim-soak.XXXXXX.log)"
RSS_LOG="$(mktemp -t sim-soak-rss.XXXXXX.csv)"

if [[ ! -x "$BIN" ]]; then
  echo "sim-soak: $BIN missing — build first" >&2
  exit 1
fi

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b

rm -f "$SOCK"
"$BIN" --udid "$UDID" --socket "$SOCK" 2>"$TMPLOG" &
DAEMON_PID=$!
trap 'kill "$DAEMON_PID" 2>/dev/null || true; rm -f "$SOCK" "$TMPLOG"' EXIT

for _ in {1..50}; do test -S "$SOCK" && break; sleep 0.1; done
if ! test -S "$SOCK"; then
  echo "sim-soak: socket never appeared" >&2
  cat "$TMPLOG" >&2 || true
  exit 1
fi

# Keep a consumer attached so the daemon emits frames continuously
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
    echo "sim-soak: daemon exited prematurely (pid $DAEMON_PID gone)" >&2
    cat "$TMPLOG" >&2 || true
    kill "$NC_PID" 2>/dev/null || true
    exit 1
  fi
  NOW=$(date +%s)
  echo "$((NOW - START_TS)),$RSS" >> "$RSS_LOG"
  if [[ "$NOW" -ge "$WARMUP_END_TS" && -z "$WARMUP_RSS" ]]; then
    WARMUP_RSS="$RSS"
    echo "warm-up complete at +${WARMUP_SEC}s; baseline RSS = ${WARMUP_RSS} KB"
  fi
  if [[ "$RSS" -gt "$MAX_RSS" ]]; then MAX_RSS="$RSS"; fi
  sleep 60
done

# Final leak check
echo "running leaks $DAEMON_PID…"
LEAK_OUT="$(leaks "$DAEMON_PID" 2>/dev/null || true)"

kill "$NC_PID" 2>/dev/null || true
kill "$DAEMON_PID" 2>/dev/null || true

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

if [[ -n "$LEAK_OUT" ]]; then
  echo "--- leaks output ---"
  echo "$LEAK_OUT" | tail -40
fi

exit 0
