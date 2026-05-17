package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadNonExistent(t *testing.T) {
	cfg, err := LoadFrom("/nonexistent/path/config.yaml")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.ServerURL != "" {
		t.Errorf("expected empty server_url, got: %s", cfg.ServerURL)
	}
}

func TestSaveAndLoad(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	cfg := &Config{
		ServerURL: "http://example.com",
		APIKey:    "df_key_test1234",
		Defaults: Defaults{
			Platform: "android",
			Timeout:  300,
			Format:   "table",
		},
	}
	if err := cfg.SaveTo(path); err != nil {
		t.Fatalf("save failed: %v", err)
	}

	loaded, err := LoadFrom(path)
	if err != nil {
		t.Fatalf("load failed: %v", err)
	}

	if loaded.ServerURL != cfg.ServerURL {
		t.Errorf("server_url: got %s, want %s", loaded.ServerURL, cfg.ServerURL)
	}
	if loaded.APIKey != cfg.APIKey {
		t.Errorf("api_key: got %s, want %s", loaded.APIKey, cfg.APIKey)
	}
	if loaded.Defaults.Platform != cfg.Defaults.Platform {
		t.Errorf("defaults.platform: got %s, want %s", loaded.Defaults.Platform, cfg.Defaults.Platform)
	}
	if loaded.Defaults.Timeout != cfg.Defaults.Timeout {
		t.Errorf("defaults.timeout: got %d, want %d", loaded.Defaults.Timeout, cfg.Defaults.Timeout)
	}
}

func TestSetGet(t *testing.T) {
	cfg := &Config{}

	tests := []struct {
		key   string
		value string
	}{
		{"server_url", "http://test.local"},
		{"api_key", "my-secret-key"},
		{"defaults.platform", "ios"},
		{"defaults.timeout", "600"},
		{"defaults.format", "json"},
	}

	for _, tt := range tests {
		if err := cfg.Set(tt.key, tt.value); err != nil {
			t.Errorf("Set(%s, %s) failed: %v", tt.key, tt.value, err)
		}
		got, err := cfg.Get(tt.key)
		if err != nil {
			t.Errorf("Get(%s) failed: %v", tt.key, err)
		}
		if got != tt.value {
			t.Errorf("Get(%s) = %s, want %s", tt.key, got, tt.value)
		}
	}
}

func TestSetUnknownKey(t *testing.T) {
	cfg := &Config{}
	if err := cfg.Set("unknown.key", "value"); err == nil {
		t.Error("expected error for unknown key, got nil")
	}
}

func TestGetUnknownKey(t *testing.T) {
	cfg := &Config{}
	_, err := cfg.Get("unknown.key")
	if err == nil {
		t.Error("expected error for unknown key, got nil")
	}
}

func TestListAll(t *testing.T) {
	cfg := &Config{
		ServerURL: "http://example.com",
		APIKey:    "df_key_test1234",
		Defaults: Defaults{
			Platform: "android",
		},
	}

	m := cfg.ListAll()
	if m["server_url"] != "http://example.com" {
		t.Errorf("server_url: got %s", m["server_url"])
	}
	// API key should be masked
	if m["api_key"] == "df_key_test1234" {
		t.Error("api_key should be masked")
	}
	if m["api_key"] == "" {
		t.Error("masked api_key should not be empty")
	}
	// Should contain last 4 chars
	if len(m["api_key"]) < 4 {
		t.Errorf("masked api_key too short: %s", m["api_key"])
	}
}

func TestListAllEmptyAPIKey(t *testing.T) {
	cfg := &Config{}
	m := cfg.ListAll()
	if m["api_key"] != "" {
		t.Errorf("empty api_key should remain empty, got: %s", m["api_key"])
	}
}

func TestFilePermissions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	cfg := &Config{ServerURL: "http://test.local"}
	if err := cfg.SaveTo(path); err != nil {
		t.Fatalf("save failed: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat failed: %v", err)
	}
	perm := info.Mode().Perm()
	if perm != 0600 {
		t.Errorf("file permissions: got %o, want 0600", perm)
	}
}
