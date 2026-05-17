// Phase 37 Plan 37-01 — heuristics helpers tests.
//
// TestClassifyName lives in parser_test.go (table-driven across all 6
// behavior cases). This file covers the small ModuleOf / ShortNameOf
// helpers and a regression-guard for the noise list.

package macho

import "testing"

func TestModuleOf(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"MyApp.HomeViewController", "MyApp"},
		{"HomeViewController", ""},
		{"A.B.C", "A"},
		{"", ""},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			if got := ModuleOf(tc.in); got != tc.want {
				t.Errorf("ModuleOf(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestShortNameOf(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"MyApp.HomeViewController", "HomeViewController"},
		{"HomeViewController", "HomeViewController"},
		{"A.B.C", "C"},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			if got := ShortNameOf(tc.in); got != tc.want {
				t.Errorf("ShortNameOf(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestViewNoiseListFiltering(t *testing.T) {
	for _, noise := range []string{"BadgeView", "IconView", "LabelView", "RowView", "CellView", "HeaderView", "FooterView"} {
		t.Run(noise, func(t *testing.T) {
			_, _, inc := ClassifyName(noise)
			if inc {
				t.Errorf("noise name %q should be filtered (inc=false), got inc=true", noise)
			}
		})
	}
}
