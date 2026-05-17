// Phase 31 Wave 0: RED state. ReadCache/WriteCache are implemented by
// Wave 1 plan 31-04 in cli/internal/updates/cache.go. Until then, this file
// fails to compile because the `updates` package does not exist.

package updates_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/device-farm/cli/internal/updates"
)

func TestCacheHit(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", dir)

	if err := updates.WriteCache("v2.0.0"); err != nil {
		t.Fatalf("WriteCache: %v", err)
	}
	tag, ok := updates.ReadCache()
	if !ok || tag != "v2.0.0" {
		t.Fatalf("expected (v2.0.0, true), got (%q, %v)", tag, ok)
	}
}

func TestCacheExpiry(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", dir)

	cachePath := filepath.Join(dir, "device-farm", "update-check.json")
	if err := os.MkdirAll(filepath.Dir(cachePath), 0o755); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{
		"tag":       "v0.0.1",
		"checkedAt": time.Now().Add(-48 * time.Hour).Format(time.RFC3339),
	})
	if err := os.WriteFile(cachePath, body, 0o644); err != nil {
		t.Fatal(err)
	}

	_, ok := updates.ReadCache()
	if ok {
		t.Fatalf("expected expired cache to return ok=false")
	}
}

func TestCacheDirAutoCreate(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", dir)

	if err := updates.WriteCache("v3.0.0"); err != nil {
		t.Fatalf("WriteCache should auto-create dir: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "device-farm", "update-check.json")); err != nil {
		t.Fatalf("cache file not written: %v", err)
	}
}
