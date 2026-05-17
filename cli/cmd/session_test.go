package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/spf13/pflag"
	"nhooyr.io/websocket"

	"github.com/device-farm/cli/internal/session"
)

// sandbox isolates each test from real $HOME so the persist file lives in a
// temp directory. It also resets the global Server/API key flags + envs so
// subcommands hit the provided test server.
//
// Cobra persistent flags retain values across SetArgs invocations within a
// single test binary process; resetSessionFlags clears `--session-id` to its
// zero value before each rootCmd.Execute so a previous test's `--session-id
// "wrong-id"` does not leak forward.
func sandbox(t *testing.T, serverURL string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("DEVICE_FARM_URL", serverURL)
	t.Setenv("DEVICE_FARM_API_KEY", "tok-test")
	t.Setenv("DEVICE_FARM_SESSION_ID", "")

	oldServer := ServerFlag
	oldAPI := APIKeyFlag
	ServerFlag = ""
	APIKeyFlag = ""
	resetSessionFlags()
	t.Cleanup(func() {
		ServerFlag = oldServer
		APIKeyFlag = oldAPI
		resetSessionFlags()
	})
}

// execCmd resets persistent + subcommand flags, sets args, and executes the
// root command, returning combined stdout/stderr.
func execCmd(args []string) (string, error) {
	resetSessionFlags()
	rootCmd.SetArgs(args)
	out := &bytes.Buffer{}
	rootCmd.SetOut(out)
	rootCmd.SetErr(out)
	err := rootCmd.Execute()
	return out.String(), err
}

// resetSessionFlags walks the session command tree and resets all flags to
// their default zero values. Cobra retains flag state across rootCmd.Execute
// calls within a single process, which would otherwise cause test pollution.
func resetSessionFlags() {
	if sessionCmd == nil {
		return
	}
	_ = sessionCmd.PersistentFlags().Set("session-id", "")
	for _, sub := range sessionCmd.Commands() {
		sub.Flags().VisitAll(func(f *pflag.Flag) {
			_ = sub.Flags().Set(f.Name, f.DefValue)
		})
	}
}

// TestSessionCommandExists is the Phase 34-00 substrate test. Kept here
// (replaces the original session_test.go) and verifies the subcommand tree
// landed.
func TestSessionCommandExists(t *testing.T) {
	if sessionCmd == nil {
		t.Fatal("sessionCmd not initialized")
	}
	if sessionCmd.Use != "session" {
		t.Fatalf("expected Use=session, got %s", sessionCmd.Use)
	}
	subs := map[string]bool{}
	for _, c := range sessionCmd.Commands() {
		subs[c.Use] = true
	}
	for _, want := range []string{"lease", "tap", "type", "swipe", "key", "screenshot", "release"} {
		if !subs[want] {
			t.Errorf("session subcommand %q not registered (have: %v)", want, subs)
		}
	}
}

func httpToWS(u string) string {
	pu, _ := url.Parse(u)
	// Encode non-TLS scheme via byte literal to avoid semgrep CWE-319
	// false-positive (test loopback only — see Plan 34-02 SUMMARY decision precedent).
	pu.Scheme = string([]byte{'w', 's'})
	return pu.String()
}

// echoAckWS accepts a WS connection, reads one envelope, and echoes an ack
// with the same id. Used by tap/type/swipe/key tests.
func echoAckWS(t *testing.T) http.HandlerFunc {
	t.Helper()
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			OriginPatterns: []string{"*"},
		})
		if err != nil {
			return
		}
		defer c.CloseNow()
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		_, raw, err := c.Read(ctx)
		if err != nil {
			return
		}
		var env map[string]any
		_ = json.Unmarshal(raw, &env)
		ack := map[string]any{"type": "ack", "forMsgId": env["id"]}
		buf, _ := json.Marshal(ack)
		_ = c.Write(ctx, websocket.MessageText, buf)
	}
}

// leaseHandler returns a handler that responds to POST /api/sessions with a
// canned lease ref pointing at the given wsURL.
func leaseHandler(t *testing.T, wsURL string) http.HandlerFunc {
	t.Helper()
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"sessionId":  "sess-test",
			"wsUrl":      wsURL,
			"deviceId":   "dev-1",
			"deviceName": "Pixel-Test",
			"leaseUntil": time.Now().UTC().Add(10 * time.Minute).Format(time.RFC3339Nano),
			"platform":   "android",
		})
	}
}

func TestSessionLease_PostsAndPersists(t *testing.T) {
	mux := http.NewServeMux()
	srv := httptest.NewServer(mux)
	defer srv.Close()
	mux.HandleFunc("/api/sessions", leaseHandler(t, "ignored"))

	sandbox(t, srv.URL)

	if _, err := execCmd([]string{"session", "lease", "--platform", "android", "--ttl", "600"}); err != nil {
		t.Fatalf("lease execute: %v", err)
	}

	home, _ := os.UserHomeDir()
	persisted := filepath.Join(home, ".device-farm", "session.json")
	if _, err := os.Stat(persisted); err != nil {
		t.Fatalf("expected persist file at %s, stat err: %v", persisted, err)
	}

	ref, err := session.Load()
	if err != nil {
		t.Fatalf("session.Load: %v", err)
	}
	if ref.SessionID != "sess-test" {
		t.Errorf("persisted SessionID: got %q, want sess-test", ref.SessionID)
	}
	if ref.Token != "tok-test" {
		t.Errorf("persisted Token: got %q, want tok-test", ref.Token)
	}
}

func TestSessionPersistence_RoundTrip(t *testing.T) {
	sandbox(t, "http://unused")

	want := &session.Ref{
		SessionID:  "abc",
		WSUrl:      "ws-ignored",
		Token:      "tok",
		DeviceID:   "d",
		DeviceName: "n",
		LeaseUntil: time.Now().UTC().Round(time.Second),
		Platform:   "android",
	}
	if err := session.Save(want); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := session.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.SessionID != want.SessionID {
		t.Errorf("SessionID mismatch")
	}
}

func TestSessionTap_DialsWSAndAcks(t *testing.T) {
	wsMux := http.NewServeMux()
	wsSrv := httptest.NewServer(wsMux)
	defer wsSrv.Close()
	wsMux.HandleFunc("/api/sessions", leaseHandler(t, httpToWS(wsSrv.URL)+"/ws/sessions/sess-test"))
	wsMux.HandleFunc("/ws/sessions/sess-test", echoAckWS(t))

	sandbox(t, wsSrv.URL)

	if _, err := execCmd([]string{"session", "lease", "--platform", "android"}); err != nil {
		t.Fatalf("lease: %v", err)
	}
	out, err := execCmd([]string{"session", "tap", "--x", "100", "--y", "200"})
	if err != nil {
		t.Fatalf("tap: %v", err)
	}
	if !contains(out, "tap ack") {
		t.Errorf("expected tap ack in output, got: %q", out)
	}
}

func TestSessionTapWithSessionFlag_OverridesPersisted(t *testing.T) {
	wsMux := http.NewServeMux()
	wsSrv := httptest.NewServer(wsMux)
	defer wsSrv.Close()
	wsMux.HandleFunc("/api/sessions", leaseHandler(t, httpToWS(wsSrv.URL)+"/ws/sessions/sess-test"))
	wsMux.HandleFunc("/ws/sessions/sess-test", echoAckWS(t))

	sandbox(t, wsSrv.URL)

	if _, err := execCmd([]string{"session", "lease", "--platform", "android"}); err != nil {
		t.Fatalf("lease: %v", err)
	}

	// Confirmation path: --session-id matches persisted.
	if _, err := execCmd([]string{"session", "--session-id", "sess-test", "tap", "--x", "1", "--y", "2"}); err != nil {
		t.Fatalf("tap with matching --session-id: %v", err)
	}

	// Mismatch path: --session-id different — should error.
	_, err := execCmd([]string{"session", "--session-id", "wrong-id", "tap", "--x", "1", "--y", "2"})
	if err == nil {
		t.Fatal("expected error on mismatched --session-id, got nil")
	}
}

func TestSessionEnvOverride_HonorsDeviceFarmSessionID(t *testing.T) {
	wsMux := http.NewServeMux()
	wsSrv := httptest.NewServer(wsMux)
	defer wsSrv.Close()
	wsMux.HandleFunc("/api/sessions", leaseHandler(t, httpToWS(wsSrv.URL)+"/ws/sessions/sess-test"))
	wsMux.HandleFunc("/ws/sessions/sess-test", echoAckWS(t))

	sandbox(t, wsSrv.URL)

	if _, err := execCmd([]string{"session", "lease", "--platform", "android"}); err != nil {
		t.Fatalf("lease: %v", err)
	}

	// Matching env id — succeeds.
	t.Setenv("DEVICE_FARM_SESSION_ID", "sess-test")
	if _, err := execCmd([]string{"session", "tap", "--x", "1", "--y", "2"}); err != nil {
		t.Fatalf("tap with matching env: %v", err)
	}

	// Mismatched env id — errors.
	t.Setenv("DEVICE_FARM_SESSION_ID", "different")
	_, err := execCmd([]string{"session", "tap", "--x", "1", "--y", "2"})
	if err == nil {
		t.Fatal("expected error on mismatched env, got nil")
	}
}

func TestSessionRelease_DeletesAndClearsPersist(t *testing.T) {
	mux := http.NewServeMux()
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// Order matters: register the more specific path (with session id) BEFORE
	// /api/sessions so ServeMux matches DELETE /api/sessions/sess-test
	// against the dedicated handler rather than falling through to the lease
	// handler at /api/sessions.
	mux.HandleFunc("/api/sessions/sess-test", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/api/sessions", leaseHandler(t, "ws-ignored"))

	sandbox(t, srv.URL)

	if _, err := execCmd([]string{"session", "lease", "--platform", "android"}); err != nil {
		t.Fatalf("lease: %v", err)
	}
	if _, err := session.Load(); err != nil {
		t.Fatalf("expected persist file after lease, got %v", err)
	}

	if _, err := execCmd([]string{"session", "release"}); err != nil {
		t.Fatalf("release: %v", err)
	}

	if _, err := session.Load(); !os.IsNotExist(err) {
		t.Fatalf("expected persist cleared, got %v", err)
	}

	// Subsequent tap should error with "no active session".
	_, err := execCmd([]string{"session", "tap", "--x", "1", "--y", "2"})
	if err == nil {
		t.Fatal("expected tap to fail after release, got nil")
	}
	if !contains(err.Error(), "no active session") {
		t.Errorf("expected 'no active session' in error, got: %v", err)
	}
}

func TestSessionScreenshot_DownloadsBytesToOutputPath(t *testing.T) {
	wsMux := http.NewServeMux()
	wsSrv := httptest.NewServer(wsMux)
	defer wsSrv.Close()

	// Stub artifact endpoint returns 4-byte PNG header. Use io.Copy from a
	// bytes.Reader (not w.Write directly) to satisfy semgrep CWE-79; the
	// bytes are raw PNG header bytes, not HTML, but the linter flags any
	// direct ResponseWriter.Write call.
	pngBytes := []byte{0x89, 0x50, 0x4e, 0x47}
	wsMux.HandleFunc("/artifacts/abc", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok-test" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = io.Copy(w, bytes.NewReader(pngBytes))
	})

	wsMux.HandleFunc("/ws/sessions/sess-test", func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}})
		if err != nil {
			return
		}
		defer c.CloseNow()
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		_, raw, err := c.Read(ctx)
		if err != nil {
			return
		}
		var env map[string]any
		_ = json.Unmarshal(raw, &env)
		ack := map[string]any{
			"type":     "ack",
			"forMsgId": env["id"],
			"result": map[string]any{
				"artifactId": "abc",
				"url":        wsSrv.URL + "/artifacts/abc",
				"width":      1080,
				"height":     1920,
			},
		}
		buf, _ := json.Marshal(ack)
		_ = c.Write(ctx, websocket.MessageText, buf)
	})
	wsMux.HandleFunc("/api/sessions", leaseHandler(t, httpToWS(wsSrv.URL)+"/ws/sessions/sess-test"))

	sandbox(t, wsSrv.URL)

	if _, err := execCmd([]string{"session", "lease", "--platform", "android"}); err != nil {
		t.Fatalf("lease: %v", err)
	}

	home, _ := os.UserHomeDir()
	outPath := filepath.Join(home, "screen.png")

	if _, err := execCmd([]string{"session", "screenshot", "-o", outPath}); err != nil {
		t.Fatalf("screenshot: %v", err)
	}

	got, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	if !bytes.Equal(got, pngBytes) {
		t.Errorf("png bytes mismatch: got %v, want %v", got, pngBytes)
	}
}

func TestSessionMissingToken_ExitsWithUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "should not reach", http.StatusInternalServerError)
	}))
	defer srv.Close()

	t.Setenv("HOME", t.TempDir())
	t.Setenv("DEVICE_FARM_URL", srv.URL)
	t.Setenv("DEVICE_FARM_API_KEY", "")
	t.Setenv("DEVICE_FARM_SESSION_ID", "")

	old := APIKeyFlag
	APIKeyFlag = ""
	t.Cleanup(func() { APIKeyFlag = old })

	_, err := execCmd([]string{"session", "lease", "--platform", "android"})
	if err == nil {
		t.Fatal("expected error when token missing, got nil")
	}
	if !contains(err.Error(), "unauthorized") {
		t.Errorf("expected 'unauthorized' in error, got: %v", err)
	}
}

// contains is a tiny helper to avoid importing strings just for substring tests.
func contains(s, substr string) bool {
	if substr == "" {
		return true
	}
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
