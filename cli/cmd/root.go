package cmd

import (
	"fmt"
	"os"
	"time"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/device-farm/cli/internal/ui"
	"github.com/device-farm/cli/internal/updates"
)

var (
	// ServerFlag holds the --server flag value.
	ServerFlag string
	// APIKeyFlag holds the --api-key flag value.
	APIKeyFlag string
	// JSONOutput indicates whether to output JSON.
	JSONOutput bool
	// NoColor indicates whether color output is disabled.
	NoColor bool
	// IsTTY indicates whether stdout is a terminal.
	IsTTY bool
)

// updateResult receives the latest release tag from the SC4 background update
// check. Buffered to 1 so the goroutine never blocks on write; reader (Execute)
// applies a short tail-wait at program exit to give cache-hit checks time to
// land. See cli/internal/updates/check.go.
var updateResult = make(chan string, 1)

// updateCheckRepo is the GitHub repo polled for releases.
const updateCheckRepo = "HeiCg/device-farm"

// updateTailWait is the maximum time Execute() waits for the background update
// check before returning. Cache hits resolve in sub-ms; cold-network calls
// (~100-300ms) miss the banner on first run, which is acceptable per the
// fire-and-forget contract — the next invocation reads from the now-populated
// cache.
const updateTailWait = 50 * time.Millisecond

var rootCmd = &cobra.Command{
	Use:   "device-farm",
	Short: "CLI for the Device Farm test execution platform",
	Long:  "Submit Maestro test jobs, monitor execution in real time, and retrieve results from the Device Farm server.",
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		if NoColor {
			color.NoColor = true
		}
		IsTTY = term.IsTerminal(int(os.Stdout.Fd()))
		if !IsTTY {
			color.NoColor = true
		}
		// SC4: fire-and-forget GitHub releases poll. Result is read at Execute()
		// time with a tail-wait; the goroutine never blocks the command body.
		go func() {
			tag := updates.Check(cmd.Context(), Version, updateCheckRepo)
			select {
			case updateResult <- tag:
			default:
				// Channel already has a value (shouldn't happen with cap=1 and
				// a single PersistentPreRun invocation per process) — drop silently.
			}
		}()
	},
	SilenceUsage:  true,
	SilenceErrors: true,
}

func init() {
	rootCmd.PersistentFlags().StringVar(&ServerFlag, "server", "", "Device Farm server URL")
	rootCmd.PersistentFlags().StringVar(&APIKeyFlag, "api-key", "", "API key for authentication")
	rootCmd.PersistentFlags().BoolVar(&JSONOutput, "json", false, "Output in JSON format")
	rootCmd.PersistentFlags().BoolVar(&NoColor, "no-color", false, "Disable colored output")
}

// Execute runs the root command and returns any error. After the command body
// completes, it waits up to updateTailWait for the background update check to
// surface a newer release; if one is found, the banner is printed to stderr
// (NOT stdout — preserves piped output like `device-farm status --json | jq`).
func Execute() error {
	err := rootCmd.Execute()
	// SC4: tail-wait for the background update check; print banner if newer.
	select {
	case tag := <-updateResult:
		if tag != "" {
			fmt.Fprint(os.Stderr, ui.RenderUpdateBanner(Version, tag))
		}
	case <-time.After(updateTailWait):
		// Goroutine still in-flight — skip banner this run; cache catches up.
	}
	return err
}
