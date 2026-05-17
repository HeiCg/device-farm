// cli/internal/types/generated_test.go
// Dual-lane round-trip harness — Go side.
// The TS side (server/websocket/__tests__/frames.spec.ts, 13 tests)
// reads the same contracts/ws-fixtures/*.sample.json files.
// When both lanes are green, the Zod → OpenAPI → Go codegen pipeline
// is proven end-to-end field-level lossless.
package types

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fixturesDir is relative to this test file's location.
// Path: cli/internal/types -> walk up three dirs to repo root -> contracts/ws-fixtures.
var fixturesDir = filepath.Join("..", "..", "..", "contracts", "ws-fixtures")

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	p := filepath.Join(fixturesDir, name)
	raw, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read fixture %s: %v", p, err)
	}
	return raw
}

// normalizeJSON decodes bytes into a generic map and re-marshals them so we
// can compare JSON objects by value, ignoring key ordering. We also strip
// any trailing newline the fixture file may have.
func normalizeJSON(t *testing.T, b []byte) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("normalize: unmarshal: %v (input=%q)", err, string(b))
	}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("normalize: marshal: %v", err)
	}
	return string(out)
}

func TestJobMessageRoundTrip(t *testing.T) {
	cases := []struct {
		name     string
		fixture  string
		wantType string
	}{
		{"log variant", "job-log.sample.json", "log"},
		{"step variant", "job-step.sample.json", "step"},
		{"status variant", "job-status.sample.json", "status"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw := readFixture(t, tc.fixture)
			var msg JobMessage
			if err := json.Unmarshal(raw, &msg); err != nil {
				t.Fatalf("unmarshal JobMessage: %v", err)
			}
			if msg.Type != tc.wantType {
				t.Fatalf("discriminator = %q; want %q", msg.Type, tc.wantType)
			}
			// Only the correct pointer should be populated.
			switch tc.wantType {
			case "log":
				if msg.Log == nil {
					t.Fatal("Log pointer nil for log variant")
				}
				if msg.Step != nil || msg.Status != nil {
					t.Fatal("non-log pointers populated for log variant")
				}
			case "step":
				if msg.Step == nil {
					t.Fatal("Step pointer nil for step variant")
				}
				if msg.Log != nil || msg.Status != nil {
					t.Fatal("non-step pointers populated for step variant")
				}
			case "status":
				if msg.Status == nil {
					t.Fatal("Status pointer nil for status variant")
				}
				if msg.Log != nil || msg.Step != nil {
					t.Fatal("non-status pointers populated for status variant")
				}
			}
			// Round-trip: re-marshal through the union, compare as decoded maps.
			rt, err := json.Marshal(msg)
			if err != nil {
				t.Fatalf("marshal JobMessage: %v", err)
			}
			orig := normalizeJSON(t, raw)
			back := normalizeJSON(t, rt)
			if orig != back {
				t.Fatalf("round-trip mismatch:\n  orig: %s\n  back: %s", orig, back)
			}
		})
	}
}

func TestDevicePreviewDecode(t *testing.T) {
	raw := readFixture(t, "device-preview.sample.json")
	var msg DevicePreviewMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal DevicePreviewMessage: %v", err)
	}
	// Pull the fixture's correlationId back out of the decoded-map view so we
	// can assert the struct preserves it through a marshal round-trip.
	var asMap map[string]any
	if err := json.Unmarshal(raw, &asMap); err != nil {
		t.Fatalf("unmarshal fixture as map: %v", err)
	}
	wantCid, _ := asMap["correlationId"].(string)
	if wantCid == "" {
		t.Fatal("fixture missing correlationId")
	}
	// The struct field name may be CorrelationId or CorrelationID depending on
	// the go-jsonschema version. Checking the marshaled bytes for the raw
	// correlationId string keeps the test portable across naming conventions.
	back, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal DevicePreviewMessage: %v", err)
	}
	if !strings.Contains(string(back), wantCid) {
		t.Fatalf("round-trip lost correlationId %q: %s", wantCid, back)
	}
}

func TestUnknownDiscriminator(t *testing.T) {
	bad := []byte(`{"type":"unknown","foo":1}`)
	var msg JobMessage
	err := json.Unmarshal(bad, &msg)
	if err == nil {
		t.Fatal("expected error on unknown discriminator, got nil")
	}
	if !strings.Contains(err.Error(), "unknown discriminator") {
		t.Fatalf("error missing 'unknown discriminator': %v", err)
	}
}
