// Phase 37 Plan 37-01 — confidence heuristics for screen classification.
//
// Port of app_explorer/skeleton/ios.py `_SCREEN_HEURISTICS` table. Classifies
// a class name into a (Confidence, Kind, Include) triple. Names that fail
// every rule return (ConfidenceLow, "", false) and should be filtered out
// of the candidate_screens list.

package macho

import "strings"

// Confidence is the per-screen heuristic score tier.
type Confidence string

const (
	ConfidenceHigh   Confidence = "high"
	ConfidenceMedium Confidence = "medium"
	ConfidenceLow    Confidence = "low"
)

// Kind describes the screen-like nature of a class.
type Kind string

const (
	KindViewController Kind = "viewcontroller"
	KindScreen         Kind = "screen"
	KindView           Kind = "view"
	KindUnknown        Kind = ""
)

// viewNoiseList lists *View suffix names that are usually UI elements
// (badges, icons) rather than full screens. Port from app-explorer.
var viewNoiseList = map[string]bool{
	"BadgeView":  true,
	"IconView":   true,
	"LabelView":  true,
	"RowView":    true,
	"CellView":   true,
	"HeaderView": true,
	"FooterView": true,
}

// ClassifyName returns the confidence tier, kind, and inclusion flag for
// a class name.
//
// Rules (priority order matches app-explorer):
//   - "*ViewController" -> (high, viewcontroller, true)
//   - "*Screen"         -> (high, screen, true)
//   - "*Page" / "*Sheet" / "*Modal" -> (medium, screen, true)
//   - "*View" AND not in noise list -> (low, view, true)
//   - everything else   -> (low, unknown, false) — filtered out
func ClassifyName(name string) (Confidence, Kind, bool) {
	if name == "" {
		return ConfidenceLow, KindUnknown, false
	}
	// Strip module prefix ("MyApp.HomeViewController" -> "HomeViewController").
	short := name
	if idx := strings.LastIndex(short, "."); idx >= 0 {
		short = short[idx+1:]
	}
	switch {
	case strings.HasSuffix(short, "ViewController"):
		return ConfidenceHigh, KindViewController, true
	case strings.HasSuffix(short, "Screen"):
		return ConfidenceHigh, KindScreen, true
	case strings.HasSuffix(short, "Page"),
		strings.HasSuffix(short, "Sheet"),
		strings.HasSuffix(short, "Modal"):
		return ConfidenceMedium, KindScreen, true
	case strings.HasSuffix(short, "View"):
		if viewNoiseList[short] {
			return ConfidenceLow, KindUnknown, false
		}
		return ConfidenceLow, KindView, true
	}
	return ConfidenceLow, KindUnknown, false
}

// ModuleOf returns the module-name prefix for a Swift mangled-name-style
// identifier like "MyApp.HomeViewController" → "MyApp". Returns empty when
// no dot is present.
func ModuleOf(name string) string {
	if idx := strings.Index(name, "."); idx > 0 {
		return name[:idx]
	}
	return ""
}

// ShortNameOf returns the trailing component after the last dot, or the
// name itself when none is present.
func ShortNameOf(name string) string {
	if idx := strings.LastIndex(name, "."); idx >= 0 {
		return name[idx+1:]
	}
	return name
}
