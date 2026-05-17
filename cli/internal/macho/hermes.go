// Phase 37 Plan 37-01 — Hermes bytecode detector + screen extractor.
//
// IsHermes (Wave 0) — magic-byte detection.
// ExtractHermesScreens (Wave 1) — `strings` scan + camelCase Screen regex +
// concatenation-artifact filter (Pitfall 3 in 37-RESEARCH.md).
//
// The filter logic is a direct port of app_explorer/react_native.py:72-128.

package macho

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
)

// HermesMagic is the Hermes bytecode magic number (first 8 bytes).
// Source: app_explorer/skeleton/react_native.py:19 — DO NOT change without
// regenerating the test fixture (hermes_test.go writes these bytes).
var HermesMagic = []byte{0xC6, 0x1F, 0xBC, 0x03, 0xC1, 0x03, 0x19, 0x1F}

// IsHermes reports whether the file at bundlePath starts with the Hermes
// bytecode magic number. Returns false on any open/read error (used as a
// classifier; callers don't care about IO error vs. "not a Hermes file").
func IsHermes(bundlePath string) bool {
	f, err := os.Open(bundlePath)
	if err != nil {
		return false
	}
	defer f.Close()
	var buf [8]byte
	if _, err := io.ReadFull(f, buf[:]); err != nil {
		return false
	}
	return bytes.Equal(buf[:], HermesMagic)
}

// hermesScreenRe matches `[A-Z][a-z][A-Za-z]{2,40}?Screen` (non-greedy).
//
// Examples:
//   - "LoginScreen"      ✓
//   - "HomeScreen"       ✓
//   - "ProfileScreen"    ✓
//   - "screen"           ✗ (lowercase start)
//   - "X"                ✗ (no [a-z])
var hermesScreenRe = regexp.MustCompile(`[A-Z][a-z][A-Za-z]{2,40}?Screen`)

// runtimeFragmentPrefixes lists JS runtime/library fragment prefixes that
// frequently appear adjacent to component names in Hermes bundles and lead
// to false-positive concatenated matches.
//
// Source: app_explorer/react_native.py:72-128 — port literally.
var runtimeFragmentPrefixes = []string{
	"Async",
	"Resolve",
	"Promise",
	"Suspend",
	"Render",
	"use",
}

// hermesUpperRunRe finds runs of 4+ consecutive uppercase letters (likely
// macros or constants — e.g. "HTTPRequestScreen" matches "HTTPR").
var hermesUpperRunRe = regexp.MustCompile(`[A-Z]{4,}`)

// hermesCamelBoundaryRe matches camelCase transitions ([a-z][A-Z]).
var hermesCamelBoundaryRe = regexp.MustCompile(`[a-z][A-Z]`)

// IsLikelyConcatenation returns true when the candidate name is likely a
// fragment glued together from adjacent JS string literals in the Hermes
// bundle (Pitfall 3).
//
// Reject when:
//   - more than 3 camelCase boundaries (LoginScreen=1, HomeScreen=1,
//     AmountSuspensePrimaryChildrenderToScreen=5+);
//   - length > 38 characters;
//   - starts with a runtime fragment prefix (Async/Resolve/Promise/...);
//   - contains a run of 4+ uppercase letters (macros).
func IsLikelyConcatenation(name string) bool {
	if len(name) > 38 {
		return true
	}
	for _, p := range runtimeFragmentPrefixes {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	if hermesUpperRunRe.MatchString(name) {
		return true
	}
	if len(hermesCamelBoundaryRe.FindAllString(name, -1)) > 3 {
		return true
	}
	return false
}

// ExtractHermesScreens runs `strings -a -n 8 <bundle>`, applies the
// camelCase Screen regex, and filters concatenation artifacts.
//
// Returns the deduplicated list of likely screen names, sorted
// alphabetically for stable test assertions.
func ExtractHermesScreens(bundlePath string) ([]string, error) {
	cmd := exec.Command("strings", "-a", "-n", "8", bundlePath)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("strings -a -n 8 %s: %w (stderr: %s)", bundlePath, err, stderr.String())
	}
	return extractScreensFromStrings(out), nil
}

// extractScreensFromStrings is the pure-function core; tests feed it
// synthetic `strings` output without spawning a subprocess.
func extractScreensFromStrings(stringsOutput []byte) []string {
	seen := map[string]struct{}{}
	for _, line := range strings.Split(string(stringsOutput), "\n") {
		matches := hermesScreenRe.FindAllString(line, -1)
		for _, m := range matches {
			if IsLikelyConcatenation(m) {
				continue
			}
			seen[m] = struct{}{}
		}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
