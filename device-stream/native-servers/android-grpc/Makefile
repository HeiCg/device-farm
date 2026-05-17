GO ?= go
PROTOC ?= protoc
PROTO_OUT := proto/gen/emulatorcontrol

.PHONY: proto build test test-race clean check-tools

check-tools:
	@command -v $(PROTOC) >/dev/null || { echo "protoc not found — install via 'brew install protobuf'"; exit 1; }
	@command -v protoc-gen-go >/dev/null || { echo "protoc-gen-go not found — run 'go install google.golang.org/protobuf/cmd/protoc-gen-go@latest'"; exit 1; }
	@command -v protoc-gen-go-grpc >/dev/null || { echo "protoc-gen-go-grpc not found — run 'go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest'"; exit 1; }

proto: check-tools
	@mkdir -p $(PROTO_OUT)
	$(PROTOC) -I proto \
	  --go_out=$(PROTO_OUT) --go_opt=paths=source_relative \
	  --go-grpc_out=$(PROTO_OUT) --go-grpc_opt=paths=source_relative \
	  proto/emulator_controller.proto

build:
	$(GO) build -o bin/android-grpc-stream ./cmd/android-grpc-stream

test:
	$(GO) test -short ./...

test-race:
	$(GO) test -race ./...

clean:
	rm -rf bin/ proto/gen/
