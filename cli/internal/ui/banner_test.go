// Phase 31 Wave 0: RED state. RenderUpdateBanner is implemented by
// Wave 1 plan 31-04 in cli/internal/ui/banner.go. Until then, this file
// fails to compile because the `ui` package does not exist.

package ui_test

import (
	"strings"
	"testing"

	"github.com/device-farm/cli/internal/ui"
)

func TestBannerBox(t *testing.T) {
	out := ui.RenderUpdateBanner("v1.0.0", "v2.0.0")
	for _, want := range []string{"v1.0.0", "v2.0.0", "device-farm self-update", "+-"} {
		if !strings.Contains(out, want) {
			t.Fatalf("banner missing %q:\n%s", want, out)
		}
	}
}

func TestBannerWidth(t *testing.T) {
	out := ui.RenderUpdateBanner("v1.0.0", "v2.0.0")
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) < 3 {
		t.Fatalf("expected at least 3 lines (top + body + bottom), got %d\n%s", len(lines), out)
	}
	for i, line := range lines {
		if len(line) == 0 {
			continue
		}
		last := line[len(line)-1:]
		if last != "+" && last != "|" {
			t.Fatalf("line %d does not end with box border (+ or |): %q", i, line)
		}
	}
}
