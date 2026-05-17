// Phase 35 Plan 35-04 (T-35.5) — `device-farm explore` subcommand.
//
// Thin Cobra glue layer that:
//  1. Parses flags into explore.StartOpts.
//  2. Resolves serverURL + apiKey via the standard config precedence
//     (flag > env > ~/.device-farm.yaml > default), shared with `run`/`status`.
//  3. Calls explore.StartExploration() — uploads APK + POSTs /api/explorations.
//  4. Calls explore.StreamEvents() — opens WS + tails frames + maps to exit code.
//
// Exit codes:
//
//	0 = exploration finished with reason="complete"
//	1 = finished with reason != complete OR error frame
//	2 = HTTP error during start (upload or POST)
//	3 = WS dial / mid-stream disconnect
//	4 = local error (config, bad URL, etc.)
//
// The `--json` persistent flag (root.go) is reused — when set, frames are
// emitted as raw JSONL on stdout. We do NOT register a local --json flag
// to avoid duplication with root.go and to keep the surface uniform with
// `status --json` and `run --json`.
package cmd

import (
	"fmt"
	"os"

	"github.com/device-farm/cli/internal/client"
	"github.com/device-farm/cli/internal/config"
	"github.com/device-farm/cli/internal/explore"
	"github.com/spf13/cobra"
)

var (
	exploreAPK            string
	exploreBundleID       string
	explorePlatform       string
	exploreBudgetTaps     int
	exploreBudgetScreens  int
	exploreBudgetSeconds  int
	exploreSeedSkeletonID string
	exploreModel          string
)

// exploreCmd replaces the Plan 35-00 stub. Full body documented in the
// package-level comment above.
var exploreCmd = &cobra.Command{
	Use:   "explore",
	Short: "Run a Claude-driven BFS exploration of an app, building a navigation graph",
	Long: `Uploads the APK/IPA, leases a device via the Phase 34 session surface,
then runs a Claude agent that systematically taps every reachable screen
and persists the result as an interactive graph viewable at
/explorations/<id>.

Streams progress events to stdout in real time. Use --json (global flag)
to emit raw JSONL frames for CI pipelines.

Examples:
  device-farm explore --apk myapp.apk --platform android
  device-farm explore --apk myapp.apk --budget-screens 80 --json
  device-farm explore --apk myapp.ipa --platform ios --seed-skeleton <id>

Exit codes:
  0  exploration finished (reason=complete)
  1  exploration finished (reason=budget/stuck/login_required/cancelled) or error frame
  2  HTTP error starting exploration (upload or POST)
  3  WS dial or mid-stream disconnect
  4  local error (missing config, bad URL, missing APK)`,
	RunE: runExplore,
}

func init() {
	exploreCmd.Flags().StringVar(&exploreAPK, "apk", "", "Path to APK/IPA file (required)")
	exploreCmd.Flags().StringVar(&exploreBundleID, "bundle-id", "",
		"Bundle ID / package name (auto-detected via aapt/plutil if omitted)")
	exploreCmd.Flags().StringVar(&explorePlatform, "platform", "android", "android|ios")
	exploreCmd.Flags().IntVar(&exploreBudgetTaps, "budget-taps", 200, "Maximum number of agent taps before terminating")
	exploreCmd.Flags().IntVar(&exploreBudgetScreens, "budget-screens", 60, "Maximum unique screens to discover before terminating")
	exploreCmd.Flags().IntVar(&exploreBudgetSeconds, "budget-seconds", 1800, "Maximum wall-clock seconds before terminating")
	exploreCmd.Flags().StringVar(&exploreSeedSkeletonID, "seed-skeleton", "",
		"Optional Phase 34 skeleton UUID to bias initial navigation")
	exploreCmd.Flags().StringVar(&exploreModel, "model", "claude-sonnet-4-5",
		"Claude model name (claude-sonnet-4-5 | claude-opus-4-7)")
	_ = exploreCmd.MarkFlagRequired("apk")
	rootCmd.AddCommand(exploreCmd)
}

func runExplore(cmd *cobra.Command, _ []string) error {
	// Resolve auth/server via standard precedence (flag > env > config > default),
	// matching `run` / `status` / `logs`.
	serverURL := config.ResolveServerURL(ServerFlag)
	apiKey := config.ResolveAPIKey(APIKeyFlag)

	// 1. START — upload artifact + POST exploration.
	start, err := explore.StartExploration(serverURL, apiKey, explore.StartOpts{
		APKPath:        exploreAPK,
		BundleID:       exploreBundleID,
		Platform:       explorePlatform,
		BudgetTaps:     exploreBudgetTaps,
		BudgetScreens:  exploreBudgetScreens,
		BudgetSeconds:  exploreBudgetSeconds,
		SeedSkeletonID: exploreSeedSkeletonID,
		Model:          exploreModel,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "start exploration: %v\n", err)
		return &client.ExitError{Code: 2, Message: ""}
	}

	// Human-readable banner — to stderr so stdout (JSONL or formatted frames)
	// stays pipe-clean.
	fmt.Fprintf(os.Stderr, "Run ID:   %s\nDevice:   %s\nSession:  %s\nStreaming events from %s ...\n\n",
		start.RunID, start.DeviceID, start.SessionID, start.AgentLogStreamURL)

	// 2. STREAM — open WS, tail frames, derive exit code from terminal frame.
	code := explore.StreamEvents(explore.StreamOpts{
		ServerURL:  serverURL,
		APIKey:     apiKey,
		RunID:      start.RunID,
		WSURL:      start.AgentLogStreamURL,
		JSONOutput: JSONOutput, // global --json flag from root.go
	})
	if code != 0 {
		return &client.ExitError{Code: code, Message: ""}
	}
	return nil
}
