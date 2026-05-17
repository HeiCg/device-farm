// Go port of kittyfarm AndroidEmulatorAuth.swift:44-101 (READ-ONLY reference at
// /Users/heicg/Desktop/projects/_reference/kittyfarm — NOT a dependency).
package auth

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// FindToken returns the gRPC bearer token for the emulator on grpcPort, or
// empty string if no token is found (some emulator builds disable auth).
//
// Lookup order (mirrors kittyfarm AndroidEmulatorAuth.swift:44-65):
//  1. Per-instance: ~/Library/Caches/TemporaryItems/avd/running/*.ini where
//     `grpc.port=<grpcPort>` → return `grpc.token`
//  2. Global fallback: ~/.emulator_console_auth_token (trimmed)
//  3. Return "" + nil error (auth-disabled emulator)
//
// Linux path differs (~/.android/avd/running/) — see TODO below.
func FindToken(grpcPort int) (string, error) {
	if tok, err := perInstanceToken(grpcPort); err != nil {
		return "", err
	} else if tok != "" {
		return tok, nil
	}
	return globalToken()
}

func perInstanceToken(grpcPort int) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	// TODO(phase-37+): linux uses ~/.android/avd/running/ — see 33-RESEARCH.md §Pitfall 6.
	runningDir := filepath.Join(home, "Library", "Caches", "TemporaryItems", "avd", "running")
	entries, err := os.ReadDir(runningDir)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	target := strconv.Itoa(grpcPort)
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".ini" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(runningDir, e.Name()))
		if err != nil {
			continue
		}
		fields := parseSimpleIni(data)
		if fields["grpc.port"] != target {
			continue
		}
		if tok := fields["grpc.token"]; tok != "" {
			return tok, nil
		}
	}
	return "", nil
}

func globalToken() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(filepath.Join(home, ".emulator_console_auth_token"))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return strings.TrimSpace(string(raw)), nil
}
