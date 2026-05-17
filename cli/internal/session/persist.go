// Package session implements the device-farm CLI's interactive session
// surface: a JSON persist file at ~/.device-farm/session.json that carries a
// leased session reference across shell invocations, plus a thin HTTP+WS
// client that talks to the server-authoritative wsUrl returned by lease.
//
// Pattern mirrors revyl-cli/internal/mcp/device_session.go:935-1022 — the
// reference implementation called out in Plan 34-06.
package session

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

// Ref is the serialized lease record. wsUrl is server-authoritative — the CLI
// NEVER constructs WS URLs locally; it persists whatever the lease response
// returned and dials that verbatim on subsequent action commands.
type Ref struct {
	SessionID  string    `json:"sessionId"`
	WSUrl      string    `json:"wsUrl"`
	Token      string    `json:"token"`
	DeviceID   string    `json:"deviceId"`
	DeviceName string    `json:"deviceName"`
	LeaseUntil time.Time `json:"leaseUntil"`
	Platform   string    `json:"platform"`
}

// persistPath resolves ~/.device-farm/session.json honoring $HOME so tests can
// sandbox the file via t.Setenv("HOME", t.TempDir()).
func persistPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".device-farm", "session.json"), nil
}

// Load reads the persisted Ref from disk. Returns os.ErrNotExist (wrapped) when
// the file is absent — callers can errors.Is to distinguish "no active session"
// from a real I/O failure.
func Load() (*Ref, error) {
	p, err := persistPath()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	var r Ref
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

// Save writes the Ref to ~/.device-farm/session.json with 0o600 permissions
// (token-bearing). Creates the parent directory with 0o700 if absent.
func Save(ref *Ref) error {
	p, err := persistPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(ref, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, b, 0o600)
}

// Clear deletes the persisted session file. Missing file is not an error —
// `device-farm session release` followed by a second invocation is a normal
// flow.
func Clear() error {
	p, err := persistPath()
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
