package cmd

import (
	"bytes"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// TestExploreCommandExists is the Wave 0 (Plan 35-00) substrate test —
// keeps passing in Plan 35-04 since we only replaced the body, not the
// registration.
func TestExploreCommandExists(t *testing.T) {
	if exploreCmd == nil {
		t.Fatal("exploreCmd is nil")
	}
	if exploreCmd.Use != "explore" {
		t.Errorf("Use = %q, want %q", exploreCmd.Use, "explore")
	}
	if exploreCmd.Short == "" {
		t.Error("Short description must not be empty")
	}
}

// TestExploreFlagsRegistered asserts the 8 Plan 35-04 flags exist on the
// Cobra command with their plan-specified defaults. We assert via
// exploreCmd.Flags().Lookup rather than triggering a parse + RunE (which
// would attempt a real network call).
func TestExploreFlagsRegistered(t *testing.T) {
	cases := []struct {
		flag    string
		want    string
		isUsage bool
	}{
		{"apk", "", false},
		{"bundle-id", "", false},
		{"platform", "android", false},
		{"budget-taps", "200", false},
		{"budget-screens", "60", false},
		{"budget-seconds", "1800", false},
		{"seed-skeleton", "", false},
		{"model", "claude-sonnet-4-5", false},
	}
	for _, tc := range cases {
		t.Run(tc.flag, func(t *testing.T) {
			f := exploreCmd.Flags().Lookup(tc.flag)
			if f == nil {
				t.Fatalf("flag --%s not registered", tc.flag)
			}
			if f.DefValue != tc.want {
				t.Errorf("--%s default = %q, want %q", tc.flag, f.DefValue, tc.want)
			}
		})
	}
}

// TestExploreApkFlagRequired asserts that running `explore` without --apk
// produces a "required" error and does NOT invoke RunE (so no network call).
func TestExploreApkFlagRequired(t *testing.T) {
	// Build an isolated rootCmd so we don't trigger global PersistentPreRun
	// (which fires the SC4 background update check).
	root := &cobra.Command{Use: "device-farm"}

	// Re-create explore with the SAME backing globals — the MarkFlagRequired
	// is already attached via init(). We clone the command to avoid mutating
	// the global registered instance.
	clone := *exploreCmd
	clone.RunE = func(_ *cobra.Command, _ []string) error {
		t.Fatal("RunE should not execute when required --apk is missing")
		return nil
	}
	root.AddCommand(&clone)

	var stdout, stderr bytes.Buffer
	root.SetOut(&stdout)
	root.SetErr(&stderr)
	root.SetArgs([]string{"explore"})

	err := root.Execute()
	if err == nil {
		t.Fatal("expected error for missing --apk, got nil")
	}
	if !strings.Contains(err.Error(), "required") || !strings.Contains(err.Error(), "apk") {
		t.Errorf("expected error mentioning required apk, got: %v", err)
	}
}

// TestExploreFlagParsing exercises Cobra's flag parser end-to-end with a
// stubbed RunE so we can assert the global flag vars are populated
// correctly without hitting the network.
func TestExploreFlagParsing(t *testing.T) {
	root := &cobra.Command{Use: "device-farm"}
	clone := *exploreCmd
	var ran bool
	clone.RunE = func(_ *cobra.Command, _ []string) error {
		ran = true
		return nil
	}
	root.AddCommand(&clone)

	// Reset globals to defaults to start clean (Cobra reuses backing vars).
	exploreAPK = ""
	exploreBundleID = ""
	explorePlatform = "android"
	exploreBudgetTaps = 200
	exploreBudgetScreens = 60
	exploreBudgetSeconds = 1800
	exploreSeedSkeletonID = ""
	exploreModel = "claude-sonnet-4-5"

	root.SetArgs([]string{
		"explore",
		"--apk", "/tmp/app.apk",
		"--bundle-id", "com.foo.bar",
		"--platform", "ios",
		"--budget-taps", "500",
		"--budget-screens", "100",
		"--budget-seconds", "3600",
		"--seed-skeleton", "abc123",
		"--model", "claude-opus-4-7",
	})

	var stdout, stderr bytes.Buffer
	root.SetOut(&stdout)
	root.SetErr(&stderr)

	if err := root.Execute(); err != nil {
		t.Fatalf("Execute: %v (stderr=%s)", err, stderr.String())
	}
	if !ran {
		t.Fatal("RunE was not invoked")
	}
	if exploreAPK != "/tmp/app.apk" {
		t.Errorf("exploreAPK = %q", exploreAPK)
	}
	if exploreBundleID != "com.foo.bar" {
		t.Errorf("exploreBundleID = %q", exploreBundleID)
	}
	if explorePlatform != "ios" {
		t.Errorf("explorePlatform = %q", explorePlatform)
	}
	if exploreBudgetTaps != 500 {
		t.Errorf("exploreBudgetTaps = %d", exploreBudgetTaps)
	}
	if exploreBudgetScreens != 100 {
		t.Errorf("exploreBudgetScreens = %d", exploreBudgetScreens)
	}
	if exploreBudgetSeconds != 3600 {
		t.Errorf("exploreBudgetSeconds = %d", exploreBudgetSeconds)
	}
	if exploreSeedSkeletonID != "abc123" {
		t.Errorf("exploreSeedSkeletonID = %q", exploreSeedSkeletonID)
	}
	if exploreModel != "claude-opus-4-7" {
		t.Errorf("exploreModel = %q", exploreModel)
	}
}

// TestExploreHelpListsAllFlags ensures `device-farm explore --help` surfaces
// the 8 plan-specified flags — important for CI users who discover flags
// via --help rather than docs.
func TestExploreHelpListsAllFlags(t *testing.T) {
	var buf bytes.Buffer
	exploreCmd.SetOut(&buf)
	exploreCmd.SetErr(&buf)
	// Help is rendered when RunE is bypassed via --help.
	_ = exploreCmd.Help()
	out := buf.String()
	wantFlags := []string{
		"--apk", "--bundle-id", "--platform",
		"--budget-taps", "--budget-screens", "--budget-seconds",
		"--seed-skeleton", "--model",
	}
	for _, f := range wantFlags {
		if !strings.Contains(out, f) {
			t.Errorf("--help output missing flag %q\n--help:\n%s", f, out)
		}
	}
}
