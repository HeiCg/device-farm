package updates

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"time"

	"golang.org/x/mod/semver"
)

// tagRe enforces a strict semver-style tag shape on GitHub release names.
// Anything else (e.g. release candidates with unusual punctuation, plain "latest")
// is rejected up-front to keep the banner contract narrow.
var tagRe = regexp.MustCompile(`^v\d+\.\d+\.\d+(-[\w.]+)?$`)

type ghRelease struct {
	TagName string `json:"tag_name"`
}

// Check polls GitHub releases for a newer version of `repo`
// (e.g. "HeiCg/device-farm").
//
// Returns the latest tag string when newer than currentVersion, "" otherwise.
//
// Returns "" early when:
//   - DEVICE_FARM_NO_UPDATE_CHECK=1
//   - CI environment variable is set (any non-empty value)
//   - GitHub returns non-200 (including 404 when no releases exist)
//   - Tag does not match ^v\d+\.\d+\.\d+(-[\w.]+)?$
//   - Network times out (3s context deadline)
//   - Cache shows we already checked within the last 24h (returns cached
//     newer-tag or "" — never re-hits GitHub during the TTL window)
//
// Intended to be invoked as `go Check(...)` from a goroutine; callers MUST
// coordinate the result via a buffered channel and a short tail-wait at
// program exit (see cli/cmd/root.go).
//
// The DEVICE_FARM_UPDATE_URL environment variable is a TEST-ONLY override
// for the GitHub endpoint and should not be documented to end users.
func Check(ctx context.Context, currentVersion string, repo string) string {
	if os.Getenv("DEVICE_FARM_NO_UPDATE_CHECK") == "1" {
		return ""
	}
	if os.Getenv("CI") != "" {
		return ""
	}

	// Cache short-circuit: if we checked within the TTL, reuse the answer
	// without hitting the network.
	if cached, ok := ReadCache(); ok {
		if isNewer(cached, currentVersion) {
			return cached
		}
		return ""
	}

	url := os.Getenv("DEVICE_FARM_UPDATE_URL")
	if url == "" {
		url = "https://api.github.com/repos/" + repo + "/releases/latest"
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(timeoutCtx, http.MethodGet, url, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "device-farm-cli")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// Graceful no-op for 404 (no releases yet), 403 (rate limit), 5xx, etc.
		return ""
	}

	var rel ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return ""
	}
	if !tagRe.MatchString(rel.TagName) {
		return ""
	}

	// Persist cache regardless of newer-than result — avoids repeated polls
	// within the TTL window even when the user is already on the latest.
	_ = WriteCache(rel.TagName)

	if isNewer(rel.TagName, currentVersion) {
		return rel.TagName
	}
	return ""
}

// isNewer returns true when latest > current via semver comparison. Both args
// are normalized to a leading "v" before comparison; non-semver inputs
// (e.g. "dev" — the default Version literal) become "vdev" which
// semver.Compare treats as invalid and orders below any real tag, so a
// dev-build user will always see a newer real release.
func isNewer(latest, current string) bool {
	if !semver.IsValid(latest) {
		latest = "v" + latest
	}
	if !semver.IsValid(current) {
		current = "v" + current
	}
	return semver.Compare(latest, current) > 0
}
