// Phase 31 Wave 0: RED state. The `updates` package (check.go + cache.go) is
// implemented by Wave 1 plan 31-04. Until then, this file fails to compile
// because `github.com/device-farm/cli/internal/updates` does not exist.
//
// The implementation MUST support an optional `DEVICE_FARM_UPDATE_URL` env
// override so these tests can point at an httptest server in place of the
// real GitHub Releases API. Default endpoint (when override is unset) is
// `https://api.github.com/repos/{repo}/releases/latest` using the GitHub
// repo `HeiCg/device-farm` (per cli go.mod placeholder; the real repo
// surface is recorded in 31-RESEARCH.md Open Question 1).

package updates_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/device-farm/cli/internal/updates"
)

func TestCheckSuppressEnvVar(t *testing.T) {
	t.Setenv("DEVICE_FARM_NO_UPDATE_CHECK", "1")
	got := updates.Check(context.Background(), "v1.0.0", "HeiCg/device-farm")
	if got != "" {
		t.Fatalf("expected empty string when DEVICE_FARM_NO_UPDATE_CHECK=1, got %q", got)
	}
}

func TestCheckSuppressCI(t *testing.T) {
	t.Setenv("CI", "true")
	t.Setenv("DEVICE_FARM_NO_UPDATE_CHECK", "")
	got := updates.Check(context.Background(), "v1.0.0", "HeiCg/device-farm")
	if got != "" {
		t.Fatalf("expected empty string when CI=true, got %q", got)
	}
}

func TestCheckNewerVersion(t *testing.T) {
	t.Setenv("DEVICE_FARM_NO_UPDATE_CHECK", "")
	t.Setenv("CI", "")
	cacheDir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", cacheDir)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"tag_name": "v2.0.0"})
	}))
	defer srv.Close()
	t.Setenv("DEVICE_FARM_UPDATE_URL", srv.URL)

	got := updates.Check(context.Background(), "v1.0.0", "HeiCg/device-farm")
	if got != "v2.0.0" {
		t.Fatalf("expected v2.0.0, got %q", got)
	}
}

func TestCheckMalformedTag(t *testing.T) {
	t.Setenv("DEVICE_FARM_NO_UPDATE_CHECK", "")
	t.Setenv("CI", "")
	cacheDir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", cacheDir)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"tag_name": "not-a-semver"})
	}))
	defer srv.Close()
	t.Setenv("DEVICE_FARM_UPDATE_URL", srv.URL)

	got := updates.Check(context.Background(), "v1.0.0", "HeiCg/device-farm")
	if got != "" {
		t.Fatalf("expected empty for malformed tag, got %q", got)
	}
}

func TestCheckTimeout(t *testing.T) {
	t.Setenv("DEVICE_FARM_NO_UPDATE_CHECK", "")
	t.Setenv("CI", "")
	cacheDir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", cacheDir)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(5 * time.Second)
		_, _ = w.Write([]byte(`{"tag_name":"v9.9.9"}`))
	}))
	defer srv.Close()
	t.Setenv("DEVICE_FARM_UPDATE_URL", srv.URL)

	start := time.Now()
	got := updates.Check(context.Background(), "v1.0.0", "HeiCg/device-farm")
	elapsed := time.Since(start)
	if got != "" {
		t.Fatalf("expected timeout to return empty, got %q", got)
	}
	if elapsed > 4*time.Second {
		t.Fatalf("expected timeout < 4s, took %v", elapsed)
	}
}

func TestCheck404(t *testing.T) {
	t.Setenv("DEVICE_FARM_NO_UPDATE_CHECK", "")
	t.Setenv("CI", "")
	cacheDir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", cacheDir)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer srv.Close()
	t.Setenv("DEVICE_FARM_UPDATE_URL", srv.URL)

	got := updates.Check(context.Background(), "v1.0.0", "HeiCg/device-farm")
	if got != "" {
		t.Fatalf("expected empty for 404, got %q", got)
	}
}

// Ensure import not removed by goimports
var _ = os.Getenv
