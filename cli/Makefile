VERSION ?= dev
REPO_ROOT := $(shell cd .. && pwd)
WS_SCHEMAS := /tmp/df-ws-schemas.json

.PHONY: build test test-race install clean types types-check

build:
	go build -ldflags "-X github.com/device-farm/cli/cmd.Version=$(VERSION)" -o bin/device-farm .

test:
	go test ./... -short -count=1

test-race:
	go test ./... -v -count=1 -race

install:
	go install .

clean:
	rm -rf bin/

# Regenerate cli/internal/types/generated.go from contracts/ws-messages.json.
# Requires:
#   - Node 22.12+ (for scripts/extract-ws-schemas.mjs)
#   - go-jsonschema v0.23+ on PATH
#     (install with: go install github.com/atombender/go-jsonschema@latest)
types:
	@echo "-> Extracting flat JSON Schema from contracts/ws-messages.json..."
	cd $(REPO_ROOT) && node scripts/extract-ws-schemas.mjs
	@echo "-> Generating Go structs with go-jsonschema..."
	@mkdir -p internal/types
	go-jsonschema --package types -o internal/types/generated.go $(WS_SCHEMAS)
	@echo "-> Running gofmt..."
	gofmt -w internal/types/generated.go
	@echo "-> Tidying cli/go.mod for new imports..."
	go mod tidy
	@echo "OK cli/internal/types/generated.go regenerated."

# CI drift guard -- runs types, then exits non-zero if anything changed in the tree
types-check: types
	@if ! git diff --quiet -- internal/types/generated.go; then \
		echo ""; \
		echo "ERROR cli/internal/types/generated.go drifted from committed version."; \
		echo "  Run \`make types\` locally and commit the result."; \
		git --no-pager diff -- internal/types/generated.go; \
		exit 1; \
	fi
	@echo "OK cli/internal/types/generated.go is up to date."
