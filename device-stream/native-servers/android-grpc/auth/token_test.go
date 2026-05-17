// Cases mirror kittyfarm AndroidEmulatorAuth.swift:44-101 + 33-RESEARCH.md
// §Auth token discovery. Tests use t.Setenv("HOME", t.TempDir()) so they
// never read the developer's real ~/Library/Caches or ~/.emulator_console_auth_token.
package auth

import (
	"os"
	"path/filepath"
	"testing"
)

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func runningDir(home string) string {
	return filepath.Join(home, "Library", "Caches", "TemporaryItems", "avd", "running")
}

func TestFindToken_PerInstance(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	mustWrite(t, filepath.Join(runningDir(home), "pid_8642.ini"), "grpc.port=8554\ngrpc.token=abc123\n")

	tok, err := FindToken(8554)
	if err != nil {
		t.Fatal(err)
	}
	if tok != "abc123" {
		t.Fatalf("want=abc123 got=%q", tok)
	}
}

func TestFindToken_PortMismatch(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	mustWrite(t, filepath.Join(runningDir(home), "pid_111.ini"), "grpc.port=9000\ngrpc.token=wrong\n")
	mustWrite(t, filepath.Join(runningDir(home), "pid_222.ini"), "grpc.port=8554\ngrpc.token=correct\n")

	tok, err := FindToken(8554)
	if err != nil {
		t.Fatal(err)
	}
	if tok != "correct" {
		t.Fatalf("want=correct got=%q", tok)
	}
}

func TestFindToken_GlobalFallback(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	mustWrite(t, filepath.Join(home, ".emulator_console_auth_token"), "  raw-token  \n")

	tok, err := FindToken(8554)
	if err != nil {
		t.Fatal(err)
	}
	if tok != "raw-token" {
		t.Fatalf("want=raw-token got=%q", tok)
	}
}

func TestFindToken_NoAuth(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	tok, err := FindToken(8554)
	if err != nil {
		t.Fatal(err)
	}
	if tok != "" {
		t.Fatalf("want empty got=%q", tok)
	}
}
