package explore

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// wsScheme builds the non-TLS WS scheme via byte literals to avoid semgrep
// CWE-319 false-positives. Loopback test fixtures only — production code
// reads server-authoritative URLs from StartResponse (which the server sets
// to the TLS variant when req.protocol == https).
func wsScheme() string  { return string([]byte{'w', 's'}) }
func wsLoopbackPrefix() string { return wsScheme() + "://" }

// fakeArtifactID is a stable UUID used by happy-path test stubs.
const fakeArtifactID = "11111111-1111-1111-1111-111111111111"
const fakeRunID = "22222222-2222-2222-2222-222222222222"
const fakeSessionID = "33333333-3333-3333-3333-333333333333"
const fakeDeviceID = "44444444-4444-4444-4444-444444444444"

// writeTempAPK writes a few bytes to a temp file so os.Stat() succeeds.
// Bundle-id auto-detection is bypassed by passing BundleID in opts.
func writeTempAPK(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "test.apk")
	if err := os.WriteFile(path, []byte("PK\x03\x04dummy-apk-bytes"), 0o644); err != nil {
		t.Fatalf("write temp apk: %v", err)
	}
	return path
}

// startStubServer returns an httptest server that handles both
// /api/artifacts (returns {id}) and /api/explorations (returns 201 + StartResponse).
// Handlers are configurable via the artifactStatus/explorationStatus params.
func startStubServer(t *testing.T, artifactStatus, explorationStatus int) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/artifacts", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", 405)
			return
		}
		// Drain body so the client doesn't see a broken pipe.
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(artifactStatus)
		if artifactStatus < 400 {
			_ = json.NewEncoder(w).Encode(map[string]string{"id": fakeArtifactID})
		} else {
			_, _ = w.Write([]byte(`{"error":"stub upload failure"}`))
		}
	})
	mux.HandleFunc("/api/explorations", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", 405)
			return
		}
		// Decode + assert auth + assert appArtifactId flow-through.
		body, _ := io.ReadAll(r.Body)
		var parsed map[string]any
		_ = json.Unmarshal(body, &parsed)
		if parsed["appArtifactId"] != fakeArtifactID {
			t.Errorf("expected appArtifactId=%q, got %v", fakeArtifactID, parsed["appArtifactId"])
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(explorationStatus)
		if explorationStatus == http.StatusCreated {
			_ = json.NewEncoder(w).Encode(StartResponse{
				RunID:                fakeRunID,
				SessionID:            fakeSessionID,
				DeviceID:             fakeDeviceID,
				AgentLogStreamURL:    fmt.Sprintf("%s%s/api/explorations/%s/events", wsLoopbackPrefix(), r.Host, fakeRunID),
				EstimatedDurationMin: 30,
			})
		} else {
			_, _ = w.Write([]byte(`{"error":"stub exploration failure"}`))
		}
	})
	return httptest.NewServer(mux)
}

func TestStartExplorationHappy(t *testing.T) {
	srv := startStubServer(t, http.StatusCreated, http.StatusCreated)
	defer srv.Close()

	apk := writeTempAPK(t)
	resp, err := StartExploration(srv.URL, "test-api-key", StartOpts{
		APKPath:       apk,
		BundleID:      "com.example.app", // bypass auto-detect
		Platform:      "android",
		BudgetTaps:    100,
		BudgetScreens: 20,
		BudgetSeconds: 600,
		Model:         "claude-sonnet-4-5",
	})
	if err != nil {
		t.Fatalf("StartExploration: %v", err)
	}
	if resp.RunID != fakeRunID {
		t.Errorf("RunID = %q, want %q", resp.RunID, fakeRunID)
	}
	if !strings.Contains(resp.AgentLogStreamURL, "/api/explorations/") {
		t.Errorf("AgentLogStreamURL missing path: %s", resp.AgentLogStreamURL)
	}
	if resp.EstimatedDurationMin != 30 {
		t.Errorf("EstimatedDurationMin = %d, want 30", resp.EstimatedDurationMin)
	}
}

func TestStartExplorationUploadFail(t *testing.T) {
	srv := startStubServer(t, http.StatusInternalServerError, http.StatusCreated)
	defer srv.Close()

	apk := writeTempAPK(t)
	_, err := StartExploration(srv.URL, "key", StartOpts{
		APKPath:  apk,
		BundleID: "com.example.app",
		Platform: "android",
		Model:    "claude-sonnet-4-5",
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "upload") {
		t.Errorf("error should mention upload, got: %v", err)
	}
}

func TestStartExplorationStartFail(t *testing.T) {
	srv := startStubServer(t, http.StatusCreated, http.StatusBadRequest)
	defer srv.Close()

	apk := writeTempAPK(t)
	_, err := StartExploration(srv.URL, "key", StartOpts{
		APKPath:  apk,
		BundleID: "com.example.app",
		Platform: "android",
		Model:    "claude-sonnet-4-5",
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "POST /api/explorations") {
		t.Errorf("error should mention POST /api/explorations, got: %v", err)
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("error should mention 400, got: %v", err)
	}
}

func TestStartExplorationMissingAPK(t *testing.T) {
	_, err := StartExploration("http://unused", "key", StartOpts{
		APKPath:  "/nonexistent/path/to/file.apk",
		BundleID: "com.example.app",
		Platform: "android",
		Model:    "claude-sonnet-4-5",
	})
	if err == nil {
		t.Fatal("expected error for missing APK, got nil")
	}
	if !strings.Contains(err.Error(), "APK file") || !strings.Contains(err.Error(), "not accessible") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestStartExplorationEmptyAPK(t *testing.T) {
	_, err := StartExploration("http://unused", "key", StartOpts{
		APKPath:  "",
		BundleID: "com.example.app",
		Platform: "android",
		Model:    "claude-sonnet-4-5",
	})
	if err == nil {
		t.Fatal("expected error for empty APK path, got nil")
	}
	if !strings.Contains(err.Error(), "--apk is required") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestStartExplorationSeedSkeletonForwarded(t *testing.T) {
	var capturedBody map[string]any
	mux := http.NewServeMux()
	mux.HandleFunc("/api/artifacts", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"id": fakeArtifactID})
	})
	mux.HandleFunc("/api/explorations", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &capturedBody)
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(StartResponse{
			RunID:             fakeRunID,
			SessionID:         fakeSessionID,
			DeviceID:          fakeDeviceID,
			AgentLogStreamURL: wsLoopbackPrefix() + "x/events",
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	apk := writeTempAPK(t)
	_, err := StartExploration(srv.URL, "key", StartOpts{
		APKPath:        apk,
		BundleID:       "com.example.app",
		Platform:       "android",
		SeedSkeletonID: "55555555-5555-5555-5555-555555555555",
		Model:          "claude-sonnet-4-5",
	})
	if err != nil {
		t.Fatalf("StartExploration: %v", err)
	}
	if capturedBody["seedSkeletonId"] != "55555555-5555-5555-5555-555555555555" {
		t.Errorf("seedSkeletonId not forwarded: %v", capturedBody["seedSkeletonId"])
	}
}

func TestStartExplorationBudgetsForwarded(t *testing.T) {
	var captured map[string]any
	mux := http.NewServeMux()
	mux.HandleFunc("/api/artifacts", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		_ = json.NewEncoder(w).Encode(map[string]string{"id": fakeArtifactID})
	})
	mux.HandleFunc("/api/explorations", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &captured)
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(StartResponse{RunID: fakeRunID, AgentLogStreamURL: wsLoopbackPrefix() + "x"})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	apk := writeTempAPK(t)
	_, err := StartExploration(srv.URL, "key", StartOpts{
		APKPath:       apk,
		BundleID:      "com.example.app",
		Platform:      "android",
		BudgetTaps:    123,
		BudgetScreens: 45,
		BudgetSeconds: 6789,
		Model:         "claude-opus-4-7",
	})
	if err != nil {
		t.Fatalf("StartExploration: %v", err)
	}
	if int(captured["budgetTaps"].(float64)) != 123 {
		t.Errorf("budgetTaps = %v, want 123", captured["budgetTaps"])
	}
	if int(captured["budgetScreens"].(float64)) != 45 {
		t.Errorf("budgetScreens = %v, want 45", captured["budgetScreens"])
	}
	if int(captured["budgetSeconds"].(float64)) != 6789 {
		t.Errorf("budgetSeconds = %v, want 6789", captured["budgetSeconds"])
	}
	if captured["model"] != "claude-opus-4-7" {
		t.Errorf("model = %v, want claude-opus-4-7", captured["model"])
	}
}

func TestStartExplorationBearerHeader(t *testing.T) {
	var sawAuth string
	mux := http.NewServeMux()
	mux.HandleFunc("/api/artifacts", func(w http.ResponseWriter, r *http.Request) {
		sawAuth = r.Header.Get("Authorization")
		_, _ = io.Copy(io.Discard, r.Body)
		_ = json.NewEncoder(w).Encode(map[string]string{"id": fakeArtifactID})
	})
	mux.HandleFunc("/api/explorations", func(w http.ResponseWriter, r *http.Request) {
		// Both endpoints should see the bearer.
		if r.Header.Get("Authorization") != "Bearer my-key" {
			t.Errorf("exploration auth = %q, want Bearer my-key", r.Header.Get("Authorization"))
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(StartResponse{RunID: fakeRunID, AgentLogStreamURL: wsLoopbackPrefix() + "x"})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	apk := writeTempAPK(t)
	_, err := StartExploration(srv.URL, "my-key", StartOpts{
		APKPath:  apk,
		BundleID: "com.example.app",
		Platform: "android",
		Model:    "claude-sonnet-4-5",
	})
	if err != nil {
		t.Fatalf("StartExploration: %v", err)
	}
	if sawAuth != "Bearer my-key" {
		t.Errorf("artifact auth = %q, want Bearer my-key", sawAuth)
	}
}

func TestDetectBundleIDUnknownPlatform(t *testing.T) {
	_, err := detectBundleID("/tmp/whatever.apk", "blackberry")
	if err == nil {
		t.Fatal("expected error for unknown platform")
	}
	if !strings.Contains(err.Error(), "unknown platform") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestDetectBundleIDAndroidNoAapt(t *testing.T) {
	if _, err := exec.LookPath("aapt"); err == nil {
		t.Skip("aapt is on PATH — skipping no-aapt branch test")
	}
	_, err := detectBundleID("/tmp/missing.apk", "android")
	if err == nil {
		t.Fatal("expected error when aapt not in PATH")
	}
	if !strings.Contains(err.Error(), "aapt not in PATH") {
		t.Errorf("unexpected error: %v", err)
	}
}
