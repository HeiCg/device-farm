package cmd

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

// dependency maps a doctor check to its install function.
type dependency struct {
	Name       string
	CheckNames []string // names returned by check functions (for matching against doctor results)
	Check      func() []checkResult
	Install    func() error
}

// installResult tracks the outcome of an install attempt.
type installResult struct {
	Name   string `json:"name"`
	Status string `json:"status"` // "installed", "skipped", "failed"
	Detail string `json:"detail,omitempty"`
}

// installers is the registry of all dependencies that can be auto-installed.
// Order matches doctor.go check order (excluding server check).
var installers = []dependency{
	{
		Name:       "Java/JDK",
		CheckNames: []string{"java"},
		Check:      func() []checkResult { return []checkResult{checkBinaryVersion("java", "-version", 17, parseJavaVersion)} },
		Install:    func() error { return brewInstall("openjdk@17") },
	},
	{
		Name:       "Android SDK",
		CheckNames: []string{"Android SDK", "  cmdline-tools", "  platform-tools", "  emulator", "  system-images API 35"},
		Check:      checkAndroidSDK,
		Install:    installAndroidSDK,
	},
	{
		Name:       "Xcode CLI Tools",
		CheckNames: []string{"Xcode CLI Tools"},
		Check:      func() []checkResult { return []checkResult{checkXcode()} },
		Install:    installXcodeCLT,
	},
	{
		Name:       "Maestro",
		CheckNames: []string{"maestro"},
		Check:      func() []checkResult { return []checkResult{checkBinary("maestro", "--version")} },
		Install:    installMaestro,
	},
	{
		Name:       "ffmpeg",
		CheckNames: []string{"ffmpeg"},
		Check:      func() []checkResult { return []checkResult{checkBinary("ffmpeg", "-version")} },
		Install:    func() error { return brewInstall("ffmpeg") },
	},
	{
		Name:       "PostgreSQL",
		CheckNames: []string{"PostgreSQL"},
		Check:      func() []checkResult { return []checkResult{checkPostgres()} },
		Install:    installPostgres,
	},
	{
		Name:       "go-ios",
		CheckNames: []string{"go-ios"},
		Check:      func() []checkResult { return []checkResult{checkBinary("go-ios", "version")} },
		Install:    installGoIOS,
	},
	{
		Name:       "idb_companion",
		CheckNames: []string{"idb_companion"},
		Check:      func() []checkResult { return []checkResult{checkBinary("idb_companion", "--version")} },
		Install:    installIDBCompanion,
	},
	{
		Name:       "sim-capture",
		CheckNames: []string{"sim-capture"},
		Check:      func() []checkResult { return []checkResult{checkBinary("sim-capture", "--version")} },
		Install:    installSimCapture,
	},
}

var dependenciesCmd = &cobra.Command{
	Use:   "dependencies",
	Short: "Install missing dependencies detected by doctor",
	Long: `Runs doctor checks and automatically installs any missing dependencies using
brew, sdkmanager, or official install scripts.

Prerequisites: Homebrew must be installed (https://brew.sh).`,
	RunE: runDependencies,
}

func init() {
	rootCmd.AddCommand(dependenciesCmd)
}

// runDependencies is the orchestrator for the dependencies command.
func runDependencies(cmd *cobra.Command, args []string) error {
	green := color.New(color.FgGreen).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()
	bold := color.New(color.Bold).SprintFunc()

	// Step 1: Check brew prerequisite
	if err := checkBrewInstalled(); err != nil {
		if JSONOutput {
			return json.NewEncoder(os.Stdout).Encode([]installResult{
				{Name: "Homebrew", Status: "failed", Detail: err.Error()},
			})
		}
		return err
	}

	// Step 2: Run all doctor checks
	allChecks := gatherAllChecks()

	// Step 3: Build install list from failed checks
	toInstall := buildInstallList(allChecks, installers)

	if len(toInstall) == 0 {
		if JSONOutput {
			return json.NewEncoder(os.Stdout).Encode([]installResult{})
		}
		fmt.Printf("\n  %s All dependencies already installed.\n\n", green("✓"))
		return nil
	}

	// Step 4: Print what needs installing
	if !JSONOutput {
		fmt.Printf("\n  %s Found %d missing dependencies:\n", bold("!"), len(toInstall))
		for _, d := range toInstall {
			fmt.Printf("    - %s\n", d.Name)
		}
		fmt.Println()
	}

	// Step 5: Install each dependency
	var results []installResult
	installed, failed := 0, 0

	for _, dep := range toInstall {
		if !JSONOutput {
			fmt.Printf("  %s Installing %s...\n", bold(">"), dep.Name)
		}

		err := dep.Install()
		if err != nil {
			failed++
			results = append(results, installResult{
				Name:   dep.Name,
				Status: "failed",
				Detail: err.Error(),
			})
			if !JSONOutput {
				fmt.Printf("  %s %s failed: %s\n\n", red("✗"), dep.Name, err.Error())
			}
		} else {
			installed++
			results = append(results, installResult{
				Name:   dep.Name,
				Status: "installed",
			})
			if !JSONOutput {
				fmt.Printf("  %s %s done\n\n", green("✓"), dep.Name)
			}
		}
	}

	// Add skipped items
	skipped := len(installers) - len(toInstall)

	// Step 6: JSON output
	if JSONOutput {
		return json.NewEncoder(os.Stdout).Encode(results)
	}

	// Step 7: Re-run doctor checks to verify
	fmt.Printf("  %s Verifying installation...\n\n", bold(">"))
	postChecks := gatherAllChecks()
	postFails := buildInstallList(postChecks, installers)

	// Step 8: Print summary
	fmt.Printf("  %s\n", bold("Summary:"))
	fmt.Printf("    Installed: %s\n", green(fmt.Sprintf("%d", installed)))
	if failed > 0 {
		fmt.Printf("    Failed:    %s\n", red(fmt.Sprintf("%d", failed)))
	}
	fmt.Printf("    Skipped:   %d (already present)\n", skipped)

	if len(postFails) > 0 {
		fmt.Printf("\n  %s %d dependencies still missing after install:\n", red("!"), len(postFails))
		for _, d := range postFails {
			fmt.Printf("    - %s\n", d.Name)
		}
	}
	fmt.Println()

	if failed > 0 {
		return fmt.Errorf("%d install(s) failed", failed)
	}
	return nil
}

// gatherAllChecks runs all doctor checks (excluding server) and returns them.
func gatherAllChecks() []checkResult {
	var checks []checkResult
	checks = append(checks, checkBinaryVersion("java", "-version", 17, parseJavaVersion))
	checks = append(checks, checkAndroidSDK()...)
	checks = append(checks,
		checkBinary("adb", "--version"),
		checkXcode(),
		checkBinary("maestro", "--version"),
		checkBinary("ffmpeg", "-version"),
		checkPostgres(),
		checkBinaryVersion("node", "--version", 18, parseNodeVersion),
		checkBinary("go-ios", "version"),
		checkBinary("sim-capture", "--version"),
		checkBinary("idb_companion", "--version"),
	)
	return checks
}

// buildInstallList returns the subset of deps whose check results include any "fail" status.
// It matches check result names against each dependency's CheckNames list.
func buildInstallList(checks []checkResult, deps []dependency) []dependency {
	// Build a set of failed check names
	failedNames := make(map[string]bool)
	for _, c := range checks {
		if c.Status == "fail" {
			failedNames[c.Name] = true
		}
	}

	var result []dependency
	for _, d := range deps {
		for _, cn := range d.CheckNames {
			if failedNames[cn] {
				result = append(result, d)
				break
			}
		}
	}
	return result
}

// checkBrewInstalled verifies that Homebrew is available.
func checkBrewInstalled() error {
	_, err := exec.LookPath("brew")
	if err != nil {
		return fmt.Errorf("Homebrew is not installed. Install it first:\n  /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"")
	}
	return nil
}

// runStreamed executes a command and streams its output line-by-line to stdout.
func runStreamed(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Env = append(os.Environ(), "HOMEBREW_NO_AUTO_UPDATE=1")

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	cmd.Stderr = cmd.Stdout // merge stderr into stdout

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", name, err)
	}

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		fmt.Printf("    %s\n", scanner.Text())
	}

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("%s exited with error: %w", name, err)
	}
	return nil
}

// runStreamedWithDir executes a command in a specific directory with streamed output.
func runStreamedWithDir(dir, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "HOMEBREW_NO_AUTO_UPDATE=1")

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", name, err)
	}

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		fmt.Printf("    %s\n", scanner.Text())
	}

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("%s exited with error: %w", name, err)
	}
	return nil
}

// brewInstall installs a Homebrew formula with auto-update disabled.
func brewInstall(formula string) error {
	return runStreamed("brew", "install", formula)
}

// brewTapInstall taps a Homebrew repository and then installs a formula from it.
func brewTapInstall(tap, formula string) error {
	if err := runStreamed("brew", "tap", tap); err != nil {
		return fmt.Errorf("brew tap %s: %w", tap, err)
	}
	return brewInstall(formula)
}

// installAndroidSDK installs Android SDK via brew cask + sdkmanager.
func installAndroidSDK() error {
	// Step 1: Install android-commandlinetools via brew cask
	fmt.Println("    [1/4] Installing android-commandlinetools...")
	if err := runStreamed("brew", "install", "--cask", "android-commandlinetools"); err != nil {
		return fmt.Errorf("brew install android-commandlinetools: %w", err)
	}

	// Step 2: Determine and set ANDROID_HOME
	// brew --prefix returns the Homebrew installation root (e.g. /opt/homebrew)
	brewPrefixOut, err := exec.Command("brew", "--prefix").Output() // #nosec G204 -- static command
	if err != nil {
		return fmt.Errorf("brew --prefix: %w", err)
	}
	androidHome := filepath.Join(strings.TrimSpace(string(brewPrefixOut)), "share", "android-commandlinetools")
	os.Setenv("ANDROID_HOME", androidHome)
	fmt.Printf("    ANDROID_HOME=%s\n", androidHome)

	// Step 3: Accept licenses (sdkmanager requires piping "yes" for non-interactive acceptance)
	fmt.Println("    [2/4] Accepting SDK licenses...")
	sdkmanagerBin := filepath.Join(androidHome, "cmdline-tools", "latest", "bin", "sdkmanager")
	// #nosec G204 -- sdkmanagerBin is derived from brew prefix, not user input
	licCmd := exec.Command("bash", "-c", "yes | "+sdkmanagerBin+" --licenses")
	licCmd.Env = append(os.Environ(), "ANDROID_HOME="+androidHome)
	licCmd.Stdout = os.Stdout
	licCmd.Stderr = os.Stderr
	licCmd.Run() // ignore error -- some licenses may already be accepted

	// Step 4: Install SDK components
	fmt.Println("    [3/4] Installing SDK components...")
	// Components are hardcoded constants, not user input
	sdkComponents := `"platform-tools" "emulator" "platforms;android-35" "system-images;android-35;google_apis_playstore;arm64-v8a"`
	// #nosec G204 -- sdkmanagerBin is from brew prefix; sdkComponents is a hardcoded constant
	installCmd := exec.Command("bash", "-c", "yes | "+sdkmanagerBin+" "+sdkComponents)
	installCmd.Env = append(os.Environ(), "ANDROID_HOME="+androidHome)
	installCmd.Stdout = os.Stdout
	installCmd.Stderr = os.Stderr
	if err := installCmd.Run(); err != nil {
		return fmt.Errorf("sdkmanager install: %w", err)
	}

	// Update PATH for current process
	os.Setenv("PATH", filepath.Join(androidHome, "platform-tools")+":"+
		filepath.Join(androidHome, "emulator")+":"+os.Getenv("PATH"))

	// Step 5: Configure shell profile with ANDROID_HOME and PATH
	fmt.Println("    [4/4] Configuring shell...")

	added, err := ensureShellPATH(
		"# Device Farm - Android SDK",
		fmt.Sprintf("export ANDROID_HOME=%q\nexport PATH=\"$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH\"", androidHome),
	)
	if err != nil {
		if !JSONOutput {
			fmt.Printf("    ⚠ Could not update shell config: %s\n", err)
			fmt.Println("    Add manually to your shell config:")
			fmt.Printf("      export ANDROID_HOME=%s\n", androidHome)
			fmt.Printf("      export PATH=$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH\n")
		}
	} else if added && !JSONOutput {
		fmt.Printf("    ✓ Added ANDROID_HOME and PATH to %s\n", shellConfigPath())
	} else if !JSONOutput {
		fmt.Println("    ✓ Shell config already has ANDROID_HOME")
	}

	return nil
}

// installXcodeCLT installs Xcode Command Line Tools non-interactively.
func installXcodeCLT() error {
	// Create trigger file for softwareupdate
	triggerFile := "/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress"
	if err := os.WriteFile(triggerFile, nil, 0644); err != nil {
		return fmt.Errorf("could not create trigger file: %w", err)
	}
	defer os.Remove(triggerFile)

	// Find the CLT package name
	out, err := exec.Command("softwareupdate", "-l").CombinedOutput()
	if err != nil {
		return fmt.Errorf("softwareupdate -l failed: %w", err)
	}

	// Parse for "Command Line" entry
	var pkg string
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "Command Line") && strings.Contains(line, "*") {
			parts := strings.SplitN(line, "*", 2)
			if len(parts) == 2 {
				candidate := strings.TrimSpace(parts[1])
				// Remove "Label: " prefix if present
				candidate = strings.TrimPrefix(candidate, "Label: ")
				pkg = strings.TrimSpace(candidate)
			}
		}
	}
	if pkg == "" {
		// Fallback: try xcode-select --install (will open GUI dialog)
		fmt.Println("    Could not find CLT in softwareupdate list.")
		fmt.Println("    Falling back to xcode-select --install (GUI dialog will appear).")
		return exec.Command("xcode-select", "--install").Run()
	}

	fmt.Printf("    Installing: %s\n", pkg)
	return runStreamed("softwareupdate", "-i", pkg, "--verbose")
}

// installMaestro installs Maestro via the official install script.
func installMaestro() error {
	return runStreamed("bash", "-c", `curl -fsSL "https://get.maestro.mobile.dev" | bash`)
}

// installPostgres installs PostgreSQL via brew and starts the service.
func installPostgres() error {
	if err := brewInstall("postgresql@16"); err != nil {
		return err
	}
	fmt.Println("    Starting PostgreSQL service...")
	cmd := exec.Command("brew", "services", "start", "postgresql@16")
	cmd.Env = append(os.Environ(), "HOMEBREW_NO_AUTO_UPDATE=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("brew services start postgresql@16: %s", strings.TrimSpace(string(out)))
	}
	fmt.Printf("    %s\n", strings.TrimSpace(string(out)))
	return nil
}

// findDeviceStreamDir locates the device-stream sibling directory.
func findDeviceStreamDir() (string, error) {
	candidates := []string{}

	// Phase 17+ vendored device-stream as a subdirectory of the device-farm
	// repo. Look INSIDE the repo first (the common case), then fall back to
	// sibling layouts for older checkouts.
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		// .../cli/bin/device-farm → .../cli/.. (repo root) → repo/device-stream
		candidates = append(candidates,
			filepath.Join(exeDir, "..", "..", "device-stream"),     // repo/device-stream (built via cli/)
			filepath.Join(exeDir, "..", "device-stream"),           // sibling to bin
			filepath.Join(filepath.Dir(exeDir), "device-stream"),    // legacy
		)
	}

	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(cwd, "device-stream"),       // running from repo root
			filepath.Join(cwd, "..", "device-stream"), // running from a subdir
			filepath.Join(filepath.Dir(cwd), "device-stream"),
		)
	}

	for _, dir := range candidates {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			abs, _ := filepath.Abs(dir)
			return abs, nil
		}
	}

	return "", fmt.Errorf("device-stream not found — expected at ./device-stream/ in the device-farm repo or a sibling checkout")
}

// installSimCapture wires the sim-capture-private binary (Phase 32 SimulatorKit
// bridge) into the user's PATH. Strategy in priority order:
//   1. Prebuilt binary at device-stream/bin/sim-capture-private (shipped by
//      the postinstall hook OR vendored in the repo) → symlink as
//      "sim-capture" + add bin/ to PATH.
//   2. Build from source at device-stream/native-servers/sim-capture-private
//      via the build script.
//   3. (Last resort) Legacy Swift Package Manager source at
//      device-stream/tools/sim-capture for backwards compat.
func installSimCapture() error {
	deviceStreamDir, err := findDeviceStreamDir()
	if err != nil {
		return err
	}

	binDir := filepath.Join(deviceStreamDir, "bin")
	prebuiltBin := filepath.Join(binDir, "sim-capture-private")
	symlinkAs := filepath.Join(binDir, "sim-capture")

	// Strategy 1 — use prebuilt binary if present.
	if _, err := os.Stat(prebuiltBin); err == nil {
		if !JSONOutput {
			fmt.Printf("    Using prebuilt sim-capture-private at %s\n", prebuiltBin)
		}
		// Create/refresh `sim-capture` symlink pointing at the private binary
		// so existing PATH/doctor checks (which look for `sim-capture`) succeed.
		_ = os.Remove(symlinkAs)
		if err := os.Symlink("sim-capture-private", symlinkAs); err != nil {
			return fmt.Errorf("symlink sim-capture -> sim-capture-private: %w", err)
		}
	} else {
		// Strategy 2 — build via the Phase 32 script if present.
		buildScript := filepath.Join(deviceStreamDir, "scripts", "build-sim-capture-private.sh")
		if _, err := os.Stat(buildScript); err == nil {
			if !JSONOutput {
				fmt.Printf("    Building sim-capture-private via %s...\n", buildScript)
			}
			if err := runStreamedWithDir(deviceStreamDir, "bash", buildScript); err != nil {
				return fmt.Errorf("build-sim-capture-private.sh failed: %w", err)
			}
			if _, err := os.Stat(prebuiltBin); err != nil {
				return fmt.Errorf("sim-capture-private not found after build at %s", prebuiltBin)
			}
			_ = os.Remove(symlinkAs)
			if err := os.Symlink("sim-capture-private", symlinkAs); err != nil {
				return fmt.Errorf("symlink sim-capture -> sim-capture-private: %w", err)
			}
		} else {
			// Strategy 3 — legacy Swift Package Manager path (pre-Phase 32).
			simCaptureDir := filepath.Join(deviceStreamDir, "tools", "sim-capture")
			if _, err := os.Stat(simCaptureDir); err != nil {
				return fmt.Errorf("sim-capture source not found — looked for prebuilt %s, build script %s, and legacy SPM %s",
					prebuiltBin, buildScript, simCaptureDir)
			}
			if !JSONOutput {
				fmt.Printf("    Building sim-capture via SPM in %s...\n", simCaptureDir)
			}
			if err := runStreamedWithDir(simCaptureDir, "swift", "build", "-c", "release"); err != nil {
				return fmt.Errorf("swift build failed: %w", err)
			}
			binDir = filepath.Join(simCaptureDir, ".build", "release")
			if _, err := os.Stat(filepath.Join(binDir, "sim-capture")); err != nil {
				return fmt.Errorf("sim-capture binary not found after build at %s", binDir)
			}
		}
	}

	// Update current process PATH so subsequent doctor checks see the binary.
	os.Setenv("PATH", os.Getenv("PATH")+":"+binDir)

	// Add binDir to the user's shell config so future shells pick it up.
	home, _ := os.UserHomeDir()
	shellPath := binDir
	if strings.HasPrefix(binDir, home) {
		shellPath = "$HOME" + strings.TrimPrefix(binDir, home)
	}

	added, err := ensureShellPATH(
		"# Device Farm - sim-capture (iOS simulator screen capture)",
		fmt.Sprintf(`export PATH="$PATH:%s"`, shellPath),
	)
	if err != nil {
		if !JSONOutput {
			fmt.Printf("    ⚠ Could not update shell config: %s\n", err)
			fmt.Println("    Add manually to your shell config:")
			fmt.Printf("      export PATH=\"$PATH:%s\"\n", shellPath)
		}
	} else if added && !JSONOutput {
		fmt.Printf("    ✓ Added sim-capture PATH to %s\n", shellConfigPath())
	}

	return nil
}

// shellConfigPath returns the path to the user's shell configuration file.
// It detects zsh vs bash and returns the appropriate rc file path.
func shellConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}

	// Check SHELL env var first
	shell := os.Getenv("SHELL")
	if strings.Contains(shell, "zsh") {
		return filepath.Join(home, ".zshrc")
	}
	if strings.Contains(shell, "bash") {
		// On macOS, .bash_profile is sourced for login shells (default in Terminal.app)
		if runtime.GOOS == "darwin" {
			bp := filepath.Join(home, ".bash_profile")
			if _, err := os.Stat(bp); err == nil {
				return bp
			}
		}
		return filepath.Join(home, ".bashrc")
	}

	// Fallback: check which files exist
	for _, name := range []string{".zshrc", ".bash_profile", ".bashrc"} {
		p := filepath.Join(home, name)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	// Default to .zshrc on macOS, .bashrc elsewhere
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, ".zshrc")
	}
	return filepath.Join(home, ".bashrc")
}

// ensureShellPATH adds an export PATH line to the user's shell config if not already present.
// The marker is a comment used to identify the block (e.g. "# Device Farm - go-ios").
// Returns true if the line was added, false if already present.
func ensureShellPATH(marker, exportLine string) (bool, error) {
	rcPath := shellConfigPath()
	if rcPath == "" {
		return false, fmt.Errorf("could not determine shell config path")
	}

	// Read existing content
	content, err := os.ReadFile(rcPath)
	if err != nil && !os.IsNotExist(err) {
		return false, fmt.Errorf("read %s: %w", rcPath, err)
	}

	// Check if the marker or export line already exists
	existing := string(content)
	if strings.Contains(existing, exportLine) {
		return false, nil // already configured exactly
	}
	if strings.Contains(existing, marker) {
		// Marker exists but export line is stale (e.g. previous install used a
		// different path). Replace the line directly after the marker so the
		// rcfile stays in sync with the current install.
		lines := strings.Split(existing, "\n")
		for i, ln := range lines {
			if strings.TrimSpace(ln) == strings.TrimSpace(marker) && i+1 < len(lines) {
				lines[i+1] = exportLine
				if err := os.WriteFile(rcPath, []byte(strings.Join(lines, "\n")), 0644); err != nil {
					return false, fmt.Errorf("rewrite %s: %w", rcPath, err)
				}
				return true, nil
			}
		}
		// Marker found but no following line — fall through to append.
	}

	// Append a fresh block.
	block := fmt.Sprintf("\n%s\n%s\n", marker, exportLine)
	f, err := os.OpenFile(rcPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return false, fmt.Errorf("open %s: %w", rcPath, err)
	}
	defer f.Close()

	if _, err := f.WriteString(block); err != nil {
		return false, fmt.Errorf("write %s: %w", rcPath, err)
	}

	return true, nil
}

// installGoIOS installs go-ios via "go install" and configures shell PATH.
func installGoIOS() error {
	goBin, err := exec.LookPath("go")
	if err != nil {
		return fmt.Errorf("Go is required to install go-ios — install Go first (brew install go)")
	}

	if err := runStreamed(goBin, "install", "github.com/danielpaulus/go-ios@latest"); err != nil {
		return err
	}

	// Determine GOPATH/bin
	gopath := os.Getenv("GOPATH")
	if gopath == "" {
		home, _ := os.UserHomeDir()
		gopath = filepath.Join(home, "go")
	}
	gobinDir := filepath.Join(gopath, "bin")

	// Update current process PATH
	os.Setenv("PATH", gobinDir+":"+os.Getenv("PATH"))

	// Add to shell config
	added, err := ensureShellPATH(
		"# Device Farm - Go binaries (go-ios)",
		`export PATH="$HOME/go/bin:$PATH"`,
	)
	if err != nil {
		if !JSONOutput {
			fmt.Printf("    ⚠ Could not update shell config: %s\n", err)
			fmt.Println("    Add manually to your shell config:")
			fmt.Println(`      export PATH="$HOME/go/bin:$PATH"`)
		}
	} else if added && !JSONOutput {
		fmt.Printf("    ✓ Added Go bin PATH to %s\n", shellConfigPath())
	}

	return nil
}

// installIDBCompanion installs idb_companion.
// Requires full Xcode.app (not just CLI Tools). If Xcode is missing, provides instructions.
func installIDBCompanion() error {
	// Check if full Xcode is available (not just CLI tools)
	out, err := exec.Command("xcode-select", "-p").CombinedOutput()
	if err != nil || !strings.Contains(string(out), "Xcode.app") {
		return fmt.Errorf("idb_companion requires full Xcode.app installed from the App Store (not just CLI Tools).\n    Install Xcode from: https://apps.apple.com/app/xcode/id497799835\n    Then run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer")
	}
	// Tap and install via brew
	return brewTapInstall("facebook/fb", "idb-companion")
}
