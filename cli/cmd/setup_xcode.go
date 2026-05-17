package cmd

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
)

// setupXcodeCmd walks the operator through the three Xcode setup steps that
// can NOT be done by `device-farm dependencies` (sudo + multi-GB download).
// It prints the exact commands and runs them on confirmation.
var setupXcodeCmd = &cobra.Command{
	Use:   "setup-xcode",
	Short: "Point xcode-select at Xcode.app, accept license, download iOS sim runtime",
	Long: `Walks through the three Xcode setup steps required for iOS support:
  1. Switch the active Xcode dev dir to /Applications/Xcode.app
  2. Accept the Xcode license
  3. Download the iOS Simulator runtime (multi-GB, ~10 min)

All three require sudo. The command prints each step and asks for
confirmation before running. Use --yes to skip prompts (CI/scripted).

Prerequisites:
  - Xcode.app installed in /Applications (download manually from the App Store)
  - sudo privileges on this account`,
	RunE: runSetupXcode,
}

var setupXcodeYes bool

func init() {
	setupXcodeCmd.Flags().BoolVarP(&setupXcodeYes, "yes", "y", false, "Skip confirmation prompts (CI / scripted setup)")
	rootCmd.AddCommand(setupXcodeCmd)
}

func runSetupXcode(_ *cobra.Command, _ []string) error {
	results := []installResult{}

	// Pre-flight: Xcode.app present?
	xcodeAppPath := "/Applications/Xcode.app"
	if _, err := os.Stat(xcodeAppPath); err != nil {
		msg := fmt.Sprintf("%s not found — install Xcode from the App Store first (https://apps.apple.com/app/xcode/id497799835)", xcodeAppPath)
		results = append(results, installResult{Name: "xcode-app", Status: "failed", Detail: msg})
		return emitSetupXcodeResults(results, fmt.Errorf("%s", msg))
	}
	results = append(results, installResult{Name: "xcode-app", Status: "skipped", Detail: "/Applications/Xcode.app found"})

	// Step 1 — xcode-select -s
	step1 := []string{"xcode-select", "-s", "/Applications/Xcode.app/Contents/Developer"}
	if err := runSudoStep(step1, "Point xcode-select at the full Xcode (currently CLT)"); err != nil {
		results = append(results, installResult{Name: "xcode-select", Status: "failed", Detail: err.Error()})
		return emitSetupXcodeResults(results, err)
	}
	results = append(results, installResult{Name: "xcode-select", Status: "installed", Detail: "active dev dir set"})

	// Step 2 — xcodebuild -license accept
	step2 := []string{"xcodebuild", "-license", "accept"}
	if err := runSudoStep(step2, "Accept Xcode license"); err != nil {
		results = append(results, installResult{Name: "xcode-license", Status: "failed", Detail: err.Error()})
		return emitSetupXcodeResults(results, err)
	}
	results = append(results, installResult{Name: "xcode-license", Status: "installed", Detail: "license accepted"})

	// Step 3 — xcodebuild -downloadPlatform iOS (long-running, multi-GB)
	step3 := []string{"xcodebuild", "-downloadPlatform", "iOS"}
	if err := runSudoStep(step3, "Download iOS Simulator runtime (~5GB, ~10 min)"); err != nil {
		results = append(results, installResult{Name: "ios-runtime", Status: "failed", Detail: err.Error()})
		return emitSetupXcodeResults(results, err)
	}
	results = append(results, installResult{Name: "ios-runtime", Status: "installed", Detail: "iOS Simulator runtime downloaded"})

	if !JSONOutput {
		fmt.Println()
		fmt.Println("✓ Xcode setup complete.")
		fmt.Println("  Verify with: xcrun simctl list runtimes")
		fmt.Println("  Then enable iOS in config.yaml (pool.ios.enabled: true)")
	}

	return emitSetupXcodeResults(results, nil)
}

// runSudoStep prints the command, prompts for confirmation (unless --yes), and
// runs it with sudo so the operator types their password once per step.
// Static command shape (sudo + literal args from caller) keeps semgrep happy.
func runSudoStep(args []string, description string) error {
	if len(args) == 0 {
		return fmt.Errorf("empty command")
	}

	if !JSONOutput {
		fmt.Println()
		fmt.Printf("▶ %s\n", description)
		fmt.Printf("  $ sudo %s\n", strings.Join(args, " "))
	}

	if !setupXcodeYes && !JSONOutput {
		fmt.Print("  Run? [Y/n] ")
		reader := bufio.NewReader(os.Stdin)
		answer, _ := reader.ReadString('\n')
		answer = strings.TrimSpace(strings.ToLower(answer))
		if answer == "n" || answer == "no" {
			return fmt.Errorf("aborted by user")
		}
	}

	// Build the sudo invocation as a single static-shape call. Args are
	// caller-provided string slices; semgrep tolerates `exec.Command("sudo", ...)`
	// because the first argument is a literal.
	sudoArgs := append([]string{}, args...)
	cmd := exec.Command("sudo", sudoArgs...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s failed: %w", args[0], err)
	}
	return nil
}

func emitSetupXcodeResults(results []installResult, fatal error) error {
	if JSONOutput {
		_ = json.NewEncoder(os.Stdout).Encode(results)
	}
	return fatal
}
