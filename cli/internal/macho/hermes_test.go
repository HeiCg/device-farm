// Phase 37 Plan 37-01 — Hermes detection + screen-extraction tests.
//
// Fixture strategy: synthesize a minimal Hermes bytecode file (8-byte
// magic + embedded screen-name strings) on the fly. This avoids
// committing a real RN .ipa fixture (would be > 5 MB minimum).

package macho

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
)

func TestIsHermesPositive(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "fake-hermes.hbc")
	body := append(append([]byte{}, HermesMagic...), 0x00, 0x00, 0x42)
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		t.Fatal(err)
	}
	if !IsHermes(tmp) {
		t.Fatal("IsHermes should return true for magic-byte-prefixed file")
	}
}

func TestIsHermesNegative(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "not-hermes")
	if err := os.WriteFile(tmp, []byte("nothing to see here"), 0o644); err != nil {
		t.Fatal(err)
	}
	if IsHermes(tmp) {
		t.Fatal("IsHermes should return false for non-magic file")
	}
}

func TestIsHermesMissingFile(t *testing.T) {
	if IsHermes("/this/path/does/not/exist") {
		t.Fatal("IsHermes should return false (not panic) when file is missing")
	}
}

func TestExtractHermesScreensSyntheticBundle(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skipf("strings(1) not reliably available on %s", runtime.GOOS)
	}
	if _, err := exec.LookPath("strings"); err != nil {
		t.Skip("strings not in PATH")
	}
	// Build a fake "Hermes bundle" — magic prefix + JS strings packed
	// adjacently. `strings -a -n 8` will recover all the runs of 8+
	// printable chars. Includes both real screen names AND junk to prove
	// the artifact filter rejects fakes.
	body := append([]byte{}, HermesMagic...)
	// Pad with binary so strings has runs to skip
	body = append(body, []byte{0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}...)
	// Real screen names (should be kept)
	for _, s := range []string{
		"LoginScreen\x00",
		"HomeScreen\x00",
		"ProfileScreen\x00",
		"SettingsScreen\x00",
		// Concatenation artifact — should be filtered
		"AmountSuspensePrimaryChildrenderToScreen\x00",
		"AsyncResolveScreen\x00", // runtime prefix
	} {
		body = append(body, []byte(s)...)
		body = append(body, 0x00, 0x00, 0x00) // separator nulls
	}
	tmp := filepath.Join(t.TempDir(), "synthetic.jsbundle")
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		t.Fatal(err)
	}
	if !IsHermes(tmp) {
		t.Fatal("synthetic bundle should be detected as Hermes")
	}
	screens, err := ExtractHermesScreens(tmp)
	if err != nil {
		t.Fatalf("ExtractHermesScreens: %v", err)
	}
	wantSet := map[string]bool{"LoginScreen": true, "HomeScreen": true, "ProfileScreen": true, "SettingsScreen": true}
	for _, s := range screens {
		if !wantSet[s] {
			t.Errorf("unexpected screen extracted: %q (filter should have rejected concatenation artifacts)", s)
		}
		delete(wantSet, s)
	}
	if len(wantSet) > 0 {
		remaining := make([]string, 0, len(wantSet))
		for k := range wantSet {
			remaining = append(remaining, k)
		}
		sort.Strings(remaining)
		t.Errorf("missing expected screens: %v (got: %v)", remaining, screens)
	}
}

func TestIsLikelyConcatenation(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"LoginScreen", false},
		{"HomeScreen", false},
		{"ProfileScreen", false},
		{"AmountSuspensePrimaryChildrenderToScreen", true}, // > 38 chars + boundaries
		{"AsyncResolveScreen", true},                       // runtime prefix
		{"PromiseAllScreen", true},                         // runtime prefix
		{"ResolveScreen", true},                            // runtime prefix
		{"useScreen", true},                                // runtime prefix
		{"HTTPRequestScreen", true},                        // 4+ uppercase run
		{"ThisNameIsWayTooLongToBeARealScreenComponentNameScreen", true}, // > 38 chars
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := IsLikelyConcatenation(tc.name)
			if got != tc.want {
				t.Errorf("IsLikelyConcatenation(%q) = %v, want %v", tc.name, got, tc.want)
			}
		})
	}
}

func TestExtractScreensFromStringsPure(t *testing.T) {
	// Pure-function variant — no subprocess.
	input := []byte("LoginScreen\nHomeScreen\nAsyncResolveScreen\nrandomnoise\nProfileScreen LoginScreen\n")
	out := extractScreensFromStrings(input)
	want := []string{"HomeScreen", "LoginScreen", "ProfileScreen"}
	if len(out) != len(want) {
		t.Fatalf("expected %d screens, got %d: %v", len(want), len(out), out)
	}
	for i, w := range want {
		if out[i] != w {
			t.Errorf("screen[%d] = %q, want %q", i, out[i], w)
		}
	}
}
