// Package updates provides a fire-and-forget GitHub releases polling helper
// used to surface a "new version available" banner on every device-farm CLI
// invocation. See check.go for the network-facing entry point; this file
// owns the 24h-TTL on-disk cache.
package updates

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

const (
	cacheFilename = "update-check.json"
	cacheTTL      = 24 * time.Hour
)

type cacheEntry struct {
	Tag       string    `json:"tag"`
	CheckedAt time.Time `json:"checkedAt"`
}

// cachePath resolves the on-disk cache location.
//
// Precedence:
//  1. $XDG_CACHE_HOME/device-farm/update-check.json (linux/XDG-aware override)
//  2. $HOME/.cache/device-farm/update-check.json (linux default)
//  3. os.UserCacheDir()/device-farm/update-check.json (cross-platform fallback)
//  4. os.TempDir()/device-farm/update-check.json (final fallback)
func cachePath() string {
	base := os.Getenv("XDG_CACHE_HOME")
	if base == "" {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			base = filepath.Join(home, ".cache")
		}
	}
	if base == "" {
		if dir, err := os.UserCacheDir(); err == nil && dir != "" {
			base = dir
		} else {
			base = os.TempDir()
		}
	}
	return filepath.Join(base, "device-farm", cacheFilename)
}

// ReadCache returns the cached release tag and ok=true if the cached entry is
// still fresh (within cacheTTL). Returns ("", false) for missing, expired,
// malformed, or unreadable cache files — all treated as "no cache".
func ReadCache() (string, bool) {
	path := cachePath()
	body, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	var entry cacheEntry
	if err := json.Unmarshal(body, &entry); err != nil {
		return "", false
	}
	if time.Since(entry.CheckedAt) > cacheTTL {
		return "", false
	}
	return entry.Tag, true
}

// WriteCache persists the release tag with a fresh checkedAt timestamp. Auto-
// creates the cache directory tree (Pitfall 6 from 31-RESEARCH.md). Returns an
// error if the filesystem write fails; callers typically ignore it (best-effort).
func WriteCache(tag string) error {
	path := cachePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	body, err := json.Marshal(cacheEntry{Tag: tag, CheckedAt: time.Now()})
	if err != nil {
		return err
	}
	return os.WriteFile(path, body, 0o644)
}
