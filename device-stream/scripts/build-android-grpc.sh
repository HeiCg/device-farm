#!/usr/bin/env bash
# Phase 33 / Wave 5 (T-33.8) — build the android-grpc-stream Go daemon (production version).
# Replaces the Wave 0 stub that exited non-zero with "not implemented".
#
# Pipeline:
#   1. Preflight: protoc + protoc-gen-go + protoc-gen-go-grpc must be on PATH.
#   2. cd device-stream/native-servers/android-grpc
#   3. make proto      (regenerates proto/gen/emulatorcontrol/*.pb.go — idempotent)
#   4. make build      (go build -o bin/android-grpc-stream ./cmd/android-grpc-stream)
#   5. Stage bin/android-grpc-stream → device-stream/bin/android-grpc-stream (chmod +x)
#   6. Smoke: --help exits 0
#
# Failure modes (all non-zero exit + diagnostic to stderr):
#   - Missing protoc / plugins: print exact `brew install` / `go install` commands
#   - go build failure: bubble up; the make rule fails fast
#   - Missing binary after build: explicit "expected output not found at ..."
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "$SCRIPT_DIR/../native-servers/android-grpc" && pwd)"
BIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/bin"

# Preflight: protoc + plugins (graceful failure for darwin dev hosts)
for tool in protoc protoc-gen-go protoc-gen-go-grpc; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "[build-android-grpc] ERROR: $tool not found on PATH." >&2
    case "$tool" in
      protoc)
        echo "  Install: brew install protobuf" >&2
        ;;
      protoc-gen-go)
        echo "  Install: go install google.golang.org/protobuf/cmd/protoc-gen-go@latest" >&2
        echo "  Then ensure \$(go env GOPATH)/bin is on PATH" >&2
        ;;
      protoc-gen-go-grpc)
        echo "  Install: go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest" >&2
        echo "  Then ensure \$(go env GOPATH)/bin is on PATH" >&2
        ;;
    esac
    exit 1
  fi
done

# Preflight: go on PATH
if ! command -v go >/dev/null 2>&1; then
  echo "[build-android-grpc] ERROR: go not found on PATH. Install Go 1.26.1+ from https://go.dev/dl/" >&2
  exit 1
fi

if [[ ! -d "$MODULE_DIR" ]]; then
  echo "[build-android-grpc] ERROR: Go module dir not found at $MODULE_DIR" >&2
  exit 1
fi

cd "$MODULE_DIR"

echo "[build-android-grpc] make proto ..."
make proto

echo "[build-android-grpc] make build ..."
make build

# Stage
BIN_SRC="$MODULE_DIR/bin/android-grpc-stream"
if [[ ! -x "$BIN_SRC" ]]; then
  echo "[build-android-grpc] ERROR: expected output not found at $BIN_SRC" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
cp -f "$BIN_SRC" "$BIN_DIR/android-grpc-stream"
chmod +x "$BIN_DIR/android-grpc-stream"

# Smoke
"$BIN_DIR/android-grpc-stream" --help >/dev/null 2>&1 || {
  echo "[build-android-grpc] ERROR: staged binary failed --help smoke" >&2
  exit 1
}

echo "[build-android-grpc] OK — staged at $BIN_DIR/android-grpc-stream"
