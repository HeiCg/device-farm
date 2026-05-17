// Phase 31 Wave 0: RED state. `streaming.UnwrapBatch` is implemented by
// Wave 1 plan 31-02 alongside the existing flat decoder in
// cli/internal/streaming/ws.go. Until then, this file fails to compile
// because UnwrapBatch is not exported from the streaming package.

package streaming_test

import (
	"encoding/json"
	"testing"

	"github.com/device-farm/cli/internal/streaming"
)

func TestBatchUnwrap(t *testing.T) {
	raw := []byte(`{"type":"batch","items":[{"type":"log","payload":{"line":"a"}},{"type":"log","payload":{"line":"b"}}]}`)
	items, err := streaming.UnwrapBatch(raw)
	if err != nil {
		t.Fatalf("UnwrapBatch: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}
	var first map[string]any
	if err := json.Unmarshal(items[0], &first); err != nil {
		t.Fatalf("decode first: %v", err)
	}
	if first["type"] != "log" {
		t.Fatalf("first item type: want log, got %v", first["type"])
	}
}

func TestBatchUnwrapPassThrough(t *testing.T) {
	raw := []byte(`{"type":"log","payload":{"line":"x"}}`)
	items, err := streaming.UnwrapBatch(raw)
	if err != nil {
		t.Fatalf("UnwrapBatch: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 passthrough item, got %d", len(items))
	}
}

func TestBatchUnwrapEmpty(t *testing.T) {
	raw := []byte(`{"type":"batch","items":[]}`)
	items, err := streaming.UnwrapBatch(raw)
	if err != nil {
		t.Fatalf("UnwrapBatch empty: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected 0 items, got %d", len(items))
	}
}

func TestBatchUnwrapMalformed(t *testing.T) {
	raw := []byte(`{not-json`)
	if _, err := streaming.UnwrapBatch(raw); err == nil {
		t.Fatal("expected error on malformed JSON, got nil")
	}
}
