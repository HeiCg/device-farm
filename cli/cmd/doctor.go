package cmd

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
	"go.yaml.in/yaml/v3"
)

var doctorCmd = &cobra.Command{
	Use:   "doctor",
	Short: "Check if all dependencies are installed and configured",
	Long: `Verifies that all dependencies required by device-farm are installed and configured.

Checks: system (arch, macOS, RAM, disk), Java 17+, Android SDK, ADB, Xcode, iOS
runtimes, Maestro, ffmpeg, PostgreSQL, Node.js 18+, git, Homebrew, iOS tools,
config.yaml, port 3000, and the device-farm server.`,
	RunE: runDoctor,
}

func init() {
	rootCmd.AddCommand(doctorCmd)
}

type checkResult struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Version string `json:"version,omitempty"`
	Path    string `json:"path,omitempty"`
	Detail  string `json:"detail,omitempty"`
}

func runDoctor(cmd *cobra.Command, args []string) error {
	var checks []checkResult

	// System
	checks = append(checks,
		checkArch(),         // DOC-S1
		checkMacOSVersion(), // DOC-S2
		checkRAM(),          // DOC-S3
		checkDiskSpace(),    // DOC-S4
	)

	// Core platform tools
	checks = append(checks,
		checkBinaryVersion("java", "-version", 17, parseJavaVersion), // DOC-01
	)
	checks = append(checks, checkAndroidSDK()...) // DOC-02
	checks = append(checks,
		checkAndroidAVDs(),                                           // DOC-02b
		checkBinary("adb", "--version"),                              // DOC-03
		checkXcode(),                                                 // DOC-04
		checkXcodeFullIDE(),                                          // DOC-04b
		checkIOSRuntimes(),                                           // DOC-04c
		checkBinary("maestro", "--version"),                          // DOC-05
		checkBinary("ffmpeg", "-version"),                            // DOC-06
		checkPostgres(),                                              // DOC-07
		checkBinaryVersion("node", "--version", 18, parseNodeVersion), // DOC-08
		checkBinary("git", "--version"),                              // DOC-G1
		checkHomebrew(),                                              // DOC-H1
		// iOS tools
		checkBinary("go-ios", "version"),       // DOC-09
		checkBinary("sim-capture", "--version"), // DOC-10
		checkBinary("idb_companion", "--version"), // DOC-11
		// Config + server
		checkConfigYaml(),   // DOC-C1
		checkPortAvailable(), // DOC-P1
		checkServer(),
	)

	if JSONOutput {
		return json.NewEncoder(os.Stdout).Encode(checks)
	}

	green := color.New(color.FgGreen).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	bold := color.New(color.Bold).SprintFunc()

	fmt.Printf("\n%s\n\n", bold("Device Farm Doctor"))
	fmt.Printf("  OS:   %s/%s\n\n", runtime.GOOS, runtime.GOARCH)

	for _, c := range checks {
		var icon string
		switch c.Status {
		case "ok":
			icon = green("✓")
		case "warn":
			icon = yellow("⚠")
		default:
			icon = red("✗")
		}

		line := fmt.Sprintf("  %s %s", icon, c.Name)
		if c.Version != "" {
			line += fmt.Sprintf("  %s", color.HiBlackString(c.Version))
		}
		fmt.Println(line)
		if c.Detail != "" && c.Status != "ok" {
			fmt.Printf("    %s\n", color.HiBlackString(c.Detail))
		}
	}

	pass, warns, fails := doctorCounts(checks)

	fmt.Println()
	if fails == 0 && warns == 0 {
		fmt.Printf("  %s  %s\n\n", green("All checks passed."), color.HiBlackString("(%d passed)", pass))
	} else if fails == 0 {
		fmt.Printf("  %s  %s\n\n", yellow("Warnings detected."), color.HiBlackString("(%d passed, %d warnings)", pass, warns))
	} else {
		fmt.Printf("  %s  %s\n\n", red("Some checks failed."), color.HiBlackString("(%d passed, %d warnings, %d failed)", pass, warns, fails))
	}

	// Actionable hints for failed checks — point operators at the right
	// installer command. Computed once over the failure set so the bottom
	// of the doctor output reads like a punch list.
	if fails > 0 {
		printDoctorHints(checks)
	}

	if doctorHasFailure(checks) {
		return fmt.Errorf("%d check(s) failed", fails)
	}
	return nil
}

func doctorHasFailure(checks []checkResult) bool {
	for _, c := range checks {
		if c.Status == "fail" {
			return true
		}
	}
	return false
}

func doctorCounts(checks []checkResult) (pass, warn, fail int) {
	for _, c := range checks {
		switch c.Status {
		case "ok":
			pass++
		case "warn":
			warn++
		default:
			fail++
		}
	}
	return
}

func checkBinary(name, versionFlag string) checkResult {
	path, err := exec.LookPath(name)
	if err != nil {
		return checkResult{Name: name, Status: "fail", Detail: "not found in PATH"}
	}

	out, err := exec.Command(path, versionFlag).CombinedOutput()
	version := ""
	if err == nil {
		// Take first non-empty line
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if line != "" {
				version = line
				break
			}
		}
	}
	// Truncate long versions
	if len(version) > 80 {
		version = version[:77] + "..."
	}

	return checkResult{Name: name, Status: "ok", Version: version, Path: path}
}

func parseJavaVersion(versionLine string) (int, error) {
	re := regexp.MustCompile(`"(\d+)`)
	m := re.FindStringSubmatch(versionLine)
	if len(m) < 2 {
		return 0, fmt.Errorf("no version found in: %s", versionLine)
	}
	return strconv.Atoi(m[1])
}

func parseNodeVersion(versionLine string) (int, error) {
	re := regexp.MustCompile(`v(\d+)`)
	m := re.FindStringSubmatch(versionLine)
	if len(m) < 2 {
		return 0, fmt.Errorf("no version found in: %s", versionLine)
	}
	return strconv.Atoi(m[1])
}

func checkBinaryVersion(name, versionFlag string, minMajor int, parseVersion func(string) (int, error)) checkResult {
	result := checkBinary(name, versionFlag)
	if result.Status != "ok" {
		return result
	}
	major, err := parseVersion(result.Version)
	if err != nil {
		result.Status = "warn"
		result.Detail = "could not parse version"
		return result
	}
	if major < minMajor {
		result.Status = "fail"
		result.Detail = fmt.Sprintf("version %d found, need >= %d", major, minMajor)
	}
	return result
}

func checkAndroidSDK() []checkResult {
	var results []checkResult
	home := os.Getenv("ANDROID_HOME")
	if home == "" {
		home = os.Getenv("ANDROID_SDK_ROOT")
	}
	if home == "" {
		return []checkResult{{Name: "Android SDK", Status: "fail", Detail: "ANDROID_HOME not set"}}
	}
	if _, err := os.Stat(home); err != nil {
		return []checkResult{{Name: "Android SDK", Status: "fail", Detail: fmt.Sprintf("directory not found: %s", home)}}
	}
	results = append(results, checkResult{Name: "Android SDK", Status: "ok", Version: home})

	components := []struct{ name, subpath string }{
		{"  cmdline-tools", "cmdline-tools/latest"},
		{"  platform-tools", "platform-tools"},
		{"  emulator", "emulator"},
		{"  system-images API 35", "system-images/android-35"},
	}
	for _, c := range components {
		path := filepath.Join(home, c.subpath)
		if info, err := os.Stat(path); err != nil || !info.IsDir() {
			results = append(results, checkResult{Name: c.name, Status: "fail", Detail: "not found at " + path})
		} else {
			results = append(results, checkResult{Name: c.name, Status: "ok", Path: path})
		}
	}
	return results
}

// checkAndroidAVDs counts AVDs created via avdmanager.
func checkAndroidAVDs() checkResult {
	home := os.Getenv("ANDROID_HOME")
	if home == "" {
		home = os.Getenv("ANDROID_SDK_ROOT")
	}
	avdmanager := "avdmanager"
	if home != "" {
		candidate := filepath.Join(home, "cmdline-tools", "latest", "bin", "avdmanager")
		if _, err := os.Stat(candidate); err == nil {
			avdmanager = candidate
		}
	}

	out, err := exec.Command(avdmanager, "list", "avd").CombinedOutput()
	if err != nil {
		return checkResult{
			Name:   "Android AVDs",
			Status: "warn",
			Detail: "avdmanager not found or failed; create one via: avdmanager create avd -n <name> -k 'system-images;android-35;google_apis_playstore;arm64-v8a'",
		}
	}

	count := 0
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "Name:") {
			count++
		}
	}
	if count == 0 {
		return checkResult{
			Name:   "Android AVDs",
			Status: "warn",
			Detail: "no AVDs found; create one via: avdmanager create avd -n Pixel9 -k 'system-images;android-35;google_apis_playstore;arm64-v8a'",
		}
	}
	return checkResult{Name: "Android AVDs", Status: "ok", Version: fmt.Sprintf("%d AVD(s)", count)}
}

func checkXcode() checkResult {
	out, err := exec.Command("xcode-select", "-p").CombinedOutput()
	if err != nil {
		return checkResult{Name: "Xcode CLI Tools", Status: "fail", Detail: "run: xcode-select --install"}
	}
	path := strings.TrimSpace(string(out))
	version := ""
	vOut, vErr := exec.Command("pkgutil", "--pkg-info=com.apple.pkg.CLTools_Executables").CombinedOutput()
	if vErr == nil {
		for _, line := range strings.Split(string(vOut), "\n") {
			if strings.HasPrefix(line, "version:") {
				version = strings.TrimSpace(strings.TrimPrefix(line, "version:"))
				break
			}
		}
	}
	return checkResult{Name: "Xcode CLI Tools", Status: "ok", Version: version, Path: path}
}

// checkXcodeFullIDE checks for full Xcode.app via xcodebuild.
func checkXcodeFullIDE() checkResult {
	out, err := exec.Command("xcodebuild", "-version").CombinedOutput()
	if err != nil {
		return checkResult{
			Name:   "Xcode.app (full IDE)",
			Status: "warn",
			Detail: "full Xcode.app not found; iOS simulators require it — install from App Store or https://developer.apple.com/xcode/",
		}
	}
	version := parseXcodebuildVersion(string(out))
	return checkResult{Name: "Xcode.app (full IDE)", Status: "ok", Version: version}
}

// parseXcodebuildVersion extracts "Xcode 16.2" from xcodebuild -version output.
func parseXcodebuildVersion(output string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Xcode ") {
			return line
		}
	}
	return strings.TrimSpace(strings.SplitN(output, "\n", 2)[0])
}

// checkIOSRuntimes checks for at least one iOS simulator runtime via simctl.
func checkIOSRuntimes() checkResult {
	out, err := exec.Command("xcrun", "simctl", "list", "runtimes", "--json").CombinedOutput()
	if err != nil {
		return checkResult{
			Name:   "iOS simulator runtimes",
			Status: "fail",
			Detail: "xcrun simctl not available; install Xcode.app",
		}
	}
	highest, err := parseSimctlRuntimes(out)
	if err != nil || highest == "" {
		return checkResult{
			Name:   "iOS simulator runtimes",
			Status: "fail",
			Detail: "no iOS runtimes installed; open Xcode → Settings → Platforms to download one",
		}
	}
	return checkResult{Name: "iOS simulator runtimes", Status: "ok", Version: "highest: " + highest}
}

// parseSimctlRuntimes returns the highest iOS version string from simctl JSON output.
func parseSimctlRuntimes(data []byte) (string, error) {
	var result struct {
		Runtimes []struct {
			Identifier string `json:"identifier"`
			Version    string `json:"version"`
			IsAvailable bool  `json:"isAvailable"`
		} `json:"runtimes"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return "", err
	}

	highest := ""
	highestMajor, highestMinor := 0, 0
	for _, rt := range result.Runtimes {
		if !strings.Contains(rt.Identifier, "com.apple.CoreSimulator.SimRuntime.iOS-") {
			continue
		}
		if !rt.IsAvailable {
			continue
		}
		major, minor := parseIOSVersion(rt.Version)
		if major > highestMajor || (major == highestMajor && minor > highestMinor) {
			highestMajor, highestMinor = major, minor
			highest = rt.Version
		}
	}
	return highest, nil
}

// parseIOSVersion parses "18.2" into (18, 2).
func parseIOSVersion(v string) (int, int) {
	parts := strings.SplitN(v, ".", 2)
	major, _ := strconv.Atoi(parts[0])
	minor := 0
	if len(parts) > 1 {
		minor, _ = strconv.Atoi(parts[1])
	}
	return major, minor
}

// checkArch ensures we are running on Apple Silicon (arm64).
func checkArch() checkResult {
	out, err := exec.Command("uname", "-m").CombinedOutput()
	if err != nil {
		return checkResult{Name: "Architecture", Status: "warn", Detail: "could not determine architecture"}
	}
	arch := strings.TrimSpace(string(out))
	if arch != "arm64" {
		return checkResult{
			Name:    "Architecture",
			Status:  "fail",
			Version: arch,
			Detail:  "device-farm requires Apple Silicon (arm64); x86_64 is incompatible with device-stream native servers",
		}
	}
	return checkResult{Name: "Architecture", Status: "ok", Version: arch}
}

// checkMacOSVersion reads sw_vers and warns on macOS Tahoe (major == 26).
func checkMacOSVersion() checkResult {
	out, err := exec.Command("sw_vers", "-productVersion").CombinedOutput()
	if err != nil {
		return checkResult{Name: "macOS version", Status: "warn", Detail: "could not determine macOS version"}
	}
	version := strings.TrimSpace(string(out))
	major := parseMacOSMajor(version)
	if major == 26 {
		return checkResult{
			Name:    "macOS version",
			Status:  "warn",
			Version: version,
			Detail:  "macOS Tahoe (26.x) detected — API 36+ Android emulators crash due to mprotect/hvf issues; use api_level: \"35\" in config.yaml",
		}
	}
	return checkResult{Name: "macOS version", Status: "ok", Version: version}
}

// parseMacOSMajor extracts the major version number from a version string like "26.3.0".
func parseMacOSMajor(version string) int {
	parts := strings.SplitN(version, ".", 2)
	major, _ := strconv.Atoi(parts[0])
	return major
}

// checkRAM reads hw.memsize and reports total GB + suggested max_devices.
func checkRAM() checkResult {
	out, err := exec.Command("sysctl", "-n", "hw.memsize").CombinedOutput()
	if err != nil {
		return checkResult{Name: "RAM", Status: "warn", Detail: "could not read hw.memsize"}
	}
	bytes, err := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
	if err != nil {
		return checkResult{Name: "RAM", Status: "warn", Detail: "could not parse hw.memsize"}
	}
	totalGB := int(bytes / (1024 * 1024 * 1024))
	suggested := suggestMaxDevices(totalGB)
	detail := fmt.Sprintf("%d GB total; suggested max_devices=%d", totalGB, suggested)
	if totalGB < 8 {
		return checkResult{
			Name:   "RAM",
			Status: "warn",
			Detail: fmt.Sprintf("only %d GB; recommend at least 8 GB; suggested max_devices=%d", totalGB, suggested),
		}
	}
	return checkResult{Name: "RAM", Status: "ok", Version: detail}
}

// suggestMaxDevices computes a safe max_devices from total RAM in GB.
func suggestMaxDevices(totalGB int) int {
	n := (totalGB - 4) / 4
	if n < 1 {
		return 1
	}
	if n > 4 {
		return 4
	}
	return n
}

// checkDiskSpace checks free disk space on root via syscall.
func checkDiskSpace() checkResult {
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err != nil {
		return checkResult{Name: "Disk space", Status: "warn", Detail: "could not stat /"}
	}
	freeBytes := stat.Bavail * uint64(stat.Bsize)
	freeGB := int(freeBytes / (1024 * 1024 * 1024))
	if freeGB < 20 {
		return checkResult{
			Name:   "Disk space",
			Status: "warn",
			Detail: fmt.Sprintf("%d GB free; emulators consume 5-10 GB each — recommend at least 20 GB free", freeGB),
		}
	}
	return checkResult{Name: "Disk space", Status: "ok", Version: fmt.Sprintf("%d GB free", freeGB)}
}

// checkHomebrew checks for brew in PATH.
func checkHomebrew() checkResult {
	path, err := exec.LookPath("brew")
	if err != nil {
		return checkResult{
			Name:   "Homebrew",
			Status: "warn",
			Detail: `not found; install: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`,
		}
	}
	out, err := exec.Command(path, "--version").CombinedOutput()
	version := ""
	if err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if line != "" {
				version = line
				break
			}
		}
	}
	return checkResult{Name: "Homebrew", Status: "ok", Version: version, Path: path}
}

// checkConfigYaml locates and parses config.yaml.
func checkConfigYaml() checkResult {
	path := findConfigYaml()
	if path == "" {
		return checkResult{
			Name:   "config.yaml",
			Status: "warn",
			Detail: "config.yaml not located; defaults will apply (set DEVICE_FARM_CONFIG or place config.yaml in cwd)",
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return checkResult{
			Name:   "config.yaml",
			Status: "warn",
			Path:   path,
			Detail: fmt.Sprintf("found but unreadable: %v", err),
		}
	}
	var v interface{}
	if err := yaml.Unmarshal(data, &v); err != nil {
		return checkResult{
			Name:   "config.yaml",
			Status: "warn",
			Path:   path,
			Detail: fmt.Sprintf("found but unparseable: %v", err),
		}
	}
	return checkResult{Name: "config.yaml", Status: "ok", Path: path}
}

// findConfigYaml returns the path to config.yaml or "" if not found.
func findConfigYaml() string {
	// 1. $DEVICE_FARM_CONFIG env var
	if envPath := os.Getenv("DEVICE_FARM_CONFIG"); envPath != "" {
		if _, err := os.Stat(envPath); err == nil {
			return envPath
		}
	}
	// 2. Current working directory
	if cwd, err := os.Getwd(); err == nil {
		candidate := filepath.Join(cwd, "config.yaml")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	// 3. Git repo root
	out, err := exec.Command("git", "rev-parse", "--show-toplevel").CombinedOutput()
	if err == nil {
		repoRoot := strings.TrimSpace(string(out))
		candidate := filepath.Join(repoRoot, "config.yaml")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return ""
}

// checkPortAvailable checks if port 3000 is available.
func checkPortAvailable() checkResult {
	ln, err := net.Listen("tcp", ":3000")
	if err != nil {
		return checkResult{
			Name:   "Port 3000",
			Status: "warn",
			Detail: "port 3000 is in use; device-farm server uses :3000 by default — another process may be occupying it",
		}
	}
	ln.Close()
	return checkResult{Name: "Port 3000", Status: "ok", Version: "available"}
}

func checkPostgres() checkResult {
	if path, err := exec.LookPath("pg_isready"); err == nil {
		out, runErr := exec.Command(path).CombinedOutput()
		if runErr == nil {
			return checkResult{Name: "PostgreSQL", Status: "ok", Version: strings.TrimSpace(string(out))}
		}
		return checkResult{Name: "PostgreSQL", Status: "warn", Detail: "installed but not running", Version: strings.TrimSpace(string(out))}
	}
	pgPaths, _ := filepath.Glob("/opt/homebrew/opt/postgresql@*/bin/pg_isready")
	for _, p := range pgPaths {
		out, runErr := exec.Command(p).CombinedOutput()
		if runErr == nil {
			return checkResult{Name: "PostgreSQL", Status: "ok", Version: strings.TrimSpace(string(out))}
		}
		return checkResult{Name: "PostgreSQL", Status: "warn", Detail: "installed but not running", Version: strings.TrimSpace(string(out))}
	}
	return checkResult{Name: "PostgreSQL", Status: "fail", Detail: "not found (install via: brew install postgresql@17)"}
}

func checkServer() checkResult {
	serverURL := "http://localhost:3000"
	if ServerFlag != "" {
		serverURL = ServerFlag
	}

	resp, err := exec.Command("curl", "-s", "--max-time", "2", serverURL+"/api/health").CombinedOutput()
	if err != nil || len(resp) == 0 {
		return checkResult{Name: "device-farm server", Status: "warn", Detail: fmt.Sprintf("not reachable at %s", serverURL)}
	}

	var health map[string]interface{}
	if json.Unmarshal(resp, &health) == nil {
		if status, ok := health["status"].(string); ok && status == "ok" {
			return checkResult{Name: "device-farm server", Status: "ok", Version: serverURL}
		}
	}

	return checkResult{Name: "device-farm server", Status: "warn", Detail: fmt.Sprintf("unexpected response from %s", serverURL)}
}

// printDoctorHints prints per-failure suggestions so the operator knows which
// installer command fixes each red row. Hint mapping is keyed by the check
// Name substring so we don't have to keep two registries in sync.
func printDoctorHints(checks []checkResult) {
	red := color.New(color.FgRed).SprintFunc()
	hints := []struct {
		match string // substring of checkResult.Name
		hint  string
	}{
		{"java", "device-farm dependencies"},
		{"Android SDK", "device-farm dependencies"},
		{"cmdline-tools", "device-farm dependencies"},
		{"platform-tools", "device-farm dependencies"},
		{"emulator", "device-farm dependencies"},
		{"system-images", "device-farm dependencies"},
		{"Android AVDs", "device-farm dependencies   # creates default android-1 AVD"},
		{"adb", "device-farm dependencies"},
		{"maestro", "device-farm dependencies   # installs Maestro CLI"},
		{"ffmpeg", "device-farm dependencies"},
		{"PostgreSQL", "device-farm dependencies && device-farm setup-db"},
		{"node", "device-farm dependencies"},
		{"git", "device-farm dependencies"},
		{"Homebrew", "Install Homebrew first: /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""},
		{"go-ios", "device-farm dependencies"},
		{"idb_companion", "device-farm dependencies   # requires Xcode.app first"},
		{"sim-capture", "device-farm dependencies   # builds + symlinks sim-capture-private"},
		{"Xcode CLI Tools", "xcode-select --install   # then re-run doctor"},
		{"Xcode.app", "Install Xcode from the App Store: https://apps.apple.com/app/xcode/id497799835"},
		{"iOS simulator runtimes", "device-farm setup-xcode   # walks through xcode-select + license + iOS runtime download"},
		{"config.yaml", "Copy config.example.yaml to config.yaml in the repo root"},
		{"device-farm server", "DATABASE_URL=postgresql://$USER@localhost:5432/device_farm npx tsx server/index.ts &"},
	}

	printed := false
	for _, c := range checks {
		if c.Status != "fail" {
			continue
		}
		for _, h := range hints {
			if strings.Contains(c.Name, h.match) {
				if !printed {
					fmt.Println("  Suggested fixes:")
					printed = true
				}
				fmt.Printf("    %s\n      → %s\n", red("✗ "+c.Name), h.hint)
				break
			}
		}
	}
	if printed {
		fmt.Println()
	}
}
