# Phase 11: CLI Dependencies - Research

**Researched:** 2026-04-15
**Domain:** Go CLI subprocess management, macOS package installation automation
**Confidence:** HIGH

## Summary

This phase adds a `device_farm dependencies` command that auto-installs missing dependencies detected by `device_farm doctor`. The existing `doctor.go` already has all check functions (`checkBinary`, `checkBinaryVersion`, `checkAndroidSDK`, `checkXcode`, `checkPostgres`) returning `checkResult` structs with status "ok"/"warn"/"fail" -- these can be reused directly to determine what needs installing.

The core challenge is orchestrating 9+ different install methods (brew, sdkmanager, curl scripts, softwareupdate, swift build) with real-time progress output. Go's `os/exec` package provides `StdoutPipe()` + `bufio.Scanner` for line-by-line streaming. Each dependency maps to a concrete install function. Special handling is needed for: (1) Homebrew prerequisite check, (2) Android SDK bootstrap sequence (brew cask -> ANDROID_HOME -> sdkmanager), (3) Xcode CLT non-interactive install via `softwareupdate`, and (4) sdkmanager license acceptance via `yes |` pipe.

**Primary recommendation:** Create an `installer` abstraction (name + check function + install function) that maps each doctor check to its install method, run failed checks through their installers sequentially with streamed output, then re-run doctor to verify.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all implementation choices are at Claude's discretion (pure infrastructure phase).

### Claude's Discretion
All implementation choices including:
- Install methods per dependency (specified in CONTEXT.md as reference)
- Code organization and abstraction patterns
- Error handling strategy
- Progress display format

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEP-01 | Install Java/JDK via brew | Brew detection + `brew install openjdk@17` pattern |
| DEP-02 | Install Android SDK components via sdkmanager | Brew cask bootstrap + sdkmanager with `yes \|` license acceptance |
| DEP-03 | Install Xcode Command Line Tools | Non-interactive `softwareupdate` approach (avoids GUI dialog) |
| DEP-04 | Install Maestro via official script | `curl -fsSL` piped to bash pattern |
| DEP-05 | Install ffmpeg via brew | Standard `brew install ffmpeg` |
| DEP-06 | Install PostgreSQL via brew | `brew install postgresql@16 && brew services start postgresql@16` |
| DEP-07 | Install go-ios via brew | Standard `brew install go-ios` |
| DEP-08 | Install idb via brew/tap | `brew tap facebook/fb && brew install idb-companion` |
| DEP-09 | Build sim-capture (swift build) | Subprocess in sibling directory `../device-stream` |
| DEP-10 | Show progress and result per item | `StdoutPipe` + `bufio.Scanner` for real-time streaming |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| os/exec | stdlib | Run subprocesses | Standard Go subprocess management |
| bufio | stdlib | Line-by-line output scanning | Real-time output streaming |
| github.com/spf13/cobra | v1.10.2 | CLI framework | Already used in project |
| github.com/fatih/color | v1.18.0 | Terminal coloring | Already used in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| os | stdlib | Environment vars, file system | PATH/ANDROID_HOME management |
| path/filepath | stdlib | Path manipulation | SDK path construction |
| strings | stdlib | Output parsing | Version extraction |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Sequential installs | Parallel goroutines | Sequential is safer -- installs may depend on each other (e.g., Java before sdkmanager) |
| Raw exec.Command | go-cmd/cmd library | Extra dependency not justified for this use case |

**No new dependencies needed.** Everything is achievable with stdlib + existing deps.

## Architecture Patterns

### Recommended Project Structure
```
cli/cmd/
  dependencies.go       # Main command + installer registry + orchestrator
  dependencies_test.go  # Unit tests for install logic
```

Single file is sufficient. The command is self-contained and follows the same pattern as `doctor.go` (single file, ~250-350 lines).

### Pattern 1: Installer Registry
**What:** Map each dependency to a check function and install function
**When to use:** When you have N dependencies each with different install methods

```go
type dependency struct {
    Name    string
    Check   func() checkResult           // reuse from doctor.go
    Install func(verbose bool) error     // the install logic
}

var dependencies = []dependency{
    {
        Name:  "Java/JDK",
        Check: func() checkResult { return checkBinaryVersion("java", "-version", 17, parseJavaVersion) },
        Install: brewInstall("openjdk@17"),
    },
    // ... etc
}
```

### Pattern 2: Real-Time Subprocess Output
**What:** Stream subprocess stdout/stderr line-by-line to the terminal
**When to use:** For long-running installs (brew, sdkmanager) where the user needs to see progress

```go
func runWithOutput(name string, args ...string) error {
    cmd := exec.Command(name, args...)
    stdout, err := cmd.StdoutPipe()
    if err != nil {
        return err
    }
    cmd.Stderr = cmd.Stdout // merge stderr into stdout pipe
    
    if err := cmd.Start(); err != nil {
        return err
    }
    
    scanner := bufio.NewScanner(stdout)
    for scanner.Scan() {
        fmt.Printf("    %s\n", scanner.Text())
    }
    
    return cmd.Wait()
}
```

**Critical:** Call `cmd.Wait()` AFTER the scanner loop completes (all reads done), not before. The Go docs explicitly warn about this race condition.

### Pattern 3: Brew Helper with Auto-Update Disabled
**What:** Wrapper that sets HOMEBREW_NO_AUTO_UPDATE=1 to speed up installs

```go
func brewInstall(formula string) func(bool) error {
    return func(verbose bool) error {
        cmd := exec.Command("brew", "install", formula)
        cmd.Env = append(os.Environ(), "HOMEBREW_NO_AUTO_UPDATE=1")
        // ... stream output
        return cmd.Wait()
    }
}
```

### Pattern 4: Orchestrator Flow
**What:** Run doctor checks, filter failures, install missing, re-verify

```
1. Run all doctor checks
2. Filter to status == "fail"
3. If none failed, print "All dependencies installed" and exit 0
4. For each failed dependency:
   a. Print "Installing {name}..."
   b. Run install function with streamed output
   c. Print result (done/failed)
5. Re-run doctor checks to verify
6. Print summary
```

### Anti-Patterns to Avoid
- **Installing already-present deps:** Always check first via doctor, skip "ok" and "warn" items
- **Swallowing install errors:** Always capture and display the full error output from failed installs
- **Hardcoded paths:** Use `exec.LookPath` and environment variables, not hardcoded `/opt/homebrew/...`
- **Blocking on GUI prompts:** Never use `xcode-select --install` directly (opens GUI); use `softwareupdate` instead

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dependency detection | Custom check logic | Reuse `doctor.go` check functions | Already tested, covers all cases |
| Brew availability check | PATH scanning | `exec.LookPath("brew")` | Standard Go idiom |
| Android SDK path | Custom path resolution | `os.Getenv("ANDROID_HOME")` + brew prefix fallback | Matches doctor.go approach |
| Progress spinners | Custom animation | Simple "Installing X... done/failed" lines | Matches project's minimal UI style |

## Common Pitfalls

### Pitfall 1: Xcode CLI Tools GUI Dialog
**What goes wrong:** `xcode-select --install` opens a macOS GUI dialog that blocks and cannot be automated
**Why it happens:** Apple designed it as an interactive experience
**How to avoid:** Use the `softwareupdate` approach:
```bash
touch /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
PROD=$(softwareupdate -l | grep "\*.*Command Line" | head -n 1 | awk -F"*" '{print $2}' | sed -e 's/^ *//' | tr -d '\n')
softwareupdate -i "$PROD" -v
rm /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
```
**Warning signs:** Script hangs waiting for GUI interaction

### Pitfall 2: sdkmanager License Prompts
**What goes wrong:** `sdkmanager` prompts interactively for license acceptance, blocking automation
**Why it happens:** No `--accept` or `--yes` flag exists
**How to avoid:** Pipe "yes" to stdin: create the command, get its stdin pipe, write "y\n" repeatedly or use `yes` command
```go
cmd := exec.Command("bash", "-c", "yes | sdkmanager --licenses")
```
Or for install commands: `yes | sdkmanager "platform-tools" "emulator" ...`

### Pitfall 3: ANDROID_HOME Not Set After Brew Cask Install
**What goes wrong:** After `brew install --cask android-commandlinetools`, ANDROID_HOME is not automatically set, so sdkmanager packages install to the wrong location
**Why it happens:** Brew cask installs to `$(brew --prefix)/share/android-commandlinetools` but doesn't set env vars
**How to avoid:** After brew cask install, set ANDROID_HOME for the current process:
```go
brewPrefix, _ := exec.Command("brew", "--prefix").Output()
androidHome := filepath.Join(strings.TrimSpace(string(brewPrefix)), "share", "android-commandlinetools")
os.Setenv("ANDROID_HOME", androidHome)
```
Also inform the user to add it to their shell profile.

### Pitfall 4: Homebrew Not Installed
**What goes wrong:** Most install methods depend on brew, but it might not be present
**Why it happens:** Fresh macOS installs don't include Homebrew
**How to avoid:** Check for brew first with `exec.LookPath("brew")`. If missing, either:
- Auto-install: `NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- Or fail early with instructions

Recommendation: Fail early with a clear message and the install command, since Homebrew installation requires sudo and should be a conscious user action.

### Pitfall 5: PATH Not Updated After Install
**What goes wrong:** After installing a tool, the Go process's PATH doesn't include the new binary
**Why it happens:** `exec.Command` inherits the current process environment; new brew installs go to `/opt/homebrew/bin` which is already in PATH, but sdkmanager-installed tools need `$ANDROID_HOME/platform-tools` etc.
**How to avoid:** After installing Android SDK components, update the process PATH:
```go
os.Setenv("PATH", filepath.Join(androidHome, "platform-tools") + ":" + os.Getenv("PATH"))
```

### Pitfall 6: StdoutPipe Race Condition
**What goes wrong:** Calling `cmd.Wait()` before reading all pipe output causes data loss
**Why it happens:** `Wait` closes the pipe; concurrent reads may miss data
**How to avoid:** Always drain the scanner completely before calling `Wait()`

## Code Examples

### Main Command Structure
```go
var dependenciesCmd = &cobra.Command{
    Use:   "dependencies",
    Short: "Install missing dependencies detected by doctor",
    Long:  `Runs doctor checks and automatically installs any missing dependencies.`,
    RunE:  runDependencies,
}

func init() {
    rootCmd.AddCommand(dependenciesCmd)
}
```

### Running Subprocess with Streamed Output
```go
func runStreamed(name string, args ...string) error {
    cmd := exec.Command(name, args...)
    cmd.Env = append(os.Environ(), "HOMEBREW_NO_AUTO_UPDATE=1")
    
    stdout, err := cmd.StdoutPipe()
    if err != nil {
        return fmt.Errorf("stdout pipe: %w", err)
    }
    cmd.Stderr = cmd.Stdout
    
    if err := cmd.Start(); err != nil {
        return fmt.Errorf("start: %w", err)
    }
    
    scanner := bufio.NewScanner(stdout)
    for scanner.Scan() {
        fmt.Printf("    %s\n", scanner.Text())
    }
    
    if err := cmd.Wait(); err != nil {
        return fmt.Errorf("exit: %w", err)
    }
    return nil
}
```

### Piping "yes" to sdkmanager
```go
func installAndroidSDKComponents() error {
    // Accept licenses first
    cmd := exec.Command("bash", "-c",
        "yes | sdkmanager --licenses")
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr
    cmd.Run() // ignore error -- some licenses may already be accepted
    
    // Install components
    return runStreamed("sdkmanager",
        "platform-tools",
        "emulator",
        "platforms;android-35",
        "system-images;android-35;google_apis_playstore;arm64-v8a",
    )
}
```

### Xcode CLT Non-Interactive Install
```go
func installXcodeCLT() error {
    // Create trigger file for softwareupdate
    os.WriteFile("/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress", nil, 0644)
    defer os.Remove("/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress")
    
    // Find the CLT package name
    out, err := exec.Command("softwareupdate", "-l").CombinedOutput()
    if err != nil {
        return fmt.Errorf("softwareupdate list failed: %w", err)
    }
    
    // Parse for "Command Line Tools" entry
    var pkg string
    for _, line := range strings.Split(string(out), "\n") {
        if strings.Contains(line, "Command Line") && strings.Contains(line, "*") {
            // Extract package name after "* "
            parts := strings.SplitN(line, "*", 2)
            if len(parts) == 2 {
                pkg = strings.TrimSpace(parts[1])
            }
        }
    }
    if pkg == "" {
        return fmt.Errorf("could not find Command Line Tools in softwareupdate list")
    }
    
    return runStreamed("softwareupdate", "-i", pkg, "--verbose")
}
```

### Maestro Install via Curl Script
```go
func installMaestro() error {
    return runStreamed("bash", "-c",
        `curl -fsSL "https://get.maestro.mobile.dev" | bash`)
}
```

### JSON Output Support
```go
type installResult struct {
    Name    string `json:"name"`
    Status  string `json:"status"` // "installed", "skipped", "failed"
    Detail  string `json:"detail,omitempty"`
}

// In runDependencies, if JSONOutput:
if JSONOutput {
    return json.NewEncoder(os.Stdout).Encode(results)
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual setup docs | CLI auto-installer | This phase | One command to set up entire dev environment |
| `android-sdk` brew cask (deprecated) | `android-commandlinetools` brew cask | 2023 | Must use new cask name |
| `xcode-select --install` (GUI) | `softwareupdate -i` (headless) | Always available | Required for automation |

## Open Questions

1. **Homebrew auto-install vs fail-early**
   - What we know: Brew can be installed non-interactively with `NONINTERACTIVE=1`
   - What's unclear: Whether auto-installing brew (which needs sudo) is too aggressive
   - Recommendation: Fail early with instructions. Let user install brew themselves. Check at start of `dependencies` command.

2. **sim-capture build location**
   - What we know: CONTEXT.md says `cd ../device-stream && npm run build:sim-capture`
   - What's unclear: Whether `../device-stream` will always be a sibling directory
   - Recommendation: Try the relative path; if not found, skip with a warning and instructions

3. **Shell profile updates for ANDROID_HOME**
   - What we know: After installing Android SDK, ANDROID_HOME must be set permanently
   - What's unclear: Whether we should auto-modify ~/.zshrc or just print instructions
   - Recommendation: Print instructions for the user to add to their shell profile. Do NOT auto-modify shell configs.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Go testing (stdlib) |
| Config file | None needed (Go convention) |
| Quick run command | `cd cli && go test ./cmd/ -run TestDep -v -count=1` |
| Full suite command | `cd cli && go test ./... -v -count=1` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEP-01 | Java install via brew | unit | `go test ./cmd/ -run TestInstallJava -v` | No - Wave 0 |
| DEP-02 | Android SDK install via sdkmanager | unit | `go test ./cmd/ -run TestInstallAndroidSDK -v` | No - Wave 0 |
| DEP-03 | Xcode CLT install | unit | `go test ./cmd/ -run TestInstallXcodeCLT -v` | No - Wave 0 |
| DEP-04 | Maestro install via curl | unit | `go test ./cmd/ -run TestInstallMaestro -v` | No - Wave 0 |
| DEP-05 | ffmpeg install via brew | unit | `go test ./cmd/ -run TestInstallFfmpeg -v` | No - Wave 0 |
| DEP-06 | PostgreSQL install via brew | unit | `go test ./cmd/ -run TestInstallPostgres -v` | No - Wave 0 |
| DEP-07 | go-ios install via brew | unit | `go test ./cmd/ -run TestInstallGoIos -v` | No - Wave 0 |
| DEP-08 | idb install via brew/tap | unit | `go test ./cmd/ -run TestInstallIdb -v` | No - Wave 0 |
| DEP-09 | sim-capture build | unit | `go test ./cmd/ -run TestInstallSimCapture -v` | No - Wave 0 |
| DEP-10 | Progress display per item | unit | `go test ./cmd/ -run TestProgressDisplay -v` | No - Wave 0 |

**Note on testability:** Install functions execute real system commands (brew, sdkmanager, etc.) and cannot be truly unit tested without mocking `exec.Command`. The recommended approach is:
1. Test the orchestrator logic (filtering failed checks, building install list) with mock check results
2. Test helper functions (parsing, path construction) directly
3. Actual install behavior is verified by running `device_farm dependencies` on a real machine

### Sampling Rate
- **Per task commit:** `cd /Users/heicg/Desktop/projects/device-farm/cli && go test ./cmd/ -run TestDep -v -count=1`
- **Per wave merge:** `cd /Users/heicg/Desktop/projects/device-farm/cli && go test ./... -v -count=1`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] `cli/cmd/dependencies_test.go` -- covers DEP-01 through DEP-10
- Tests should focus on: orchestrator logic (skip already-installed), install result tracking, JSON output format, brew prerequisite check

## Sources

### Primary (HIGH confidence)
- `cli/cmd/doctor.go` -- existing check functions, checkResult struct, established patterns
- `cli/cmd/root.go` -- Cobra command registration pattern, global flags
- Go os/exec stdlib docs -- subprocess management patterns

### Secondary (MEDIUM confidence)
- [Homebrew Formulae: android-commandlinetools](https://formulae.brew.sh/cask/android-commandlinetools) -- cask install path and behavior
- [mokacoding: Xcode CLI Tools without GUI](https://mokacoding.com/blog/how-to-install-xcode-cli-tools-without-gui/) -- softwareupdate non-interactive approach
- [Homebrew Installation docs](https://docs.brew.sh/Installation) -- NONINTERACTIVE=1 and HOMEBREW_NO_AUTO_UPDATE=1

### Tertiary (LOW confidence)
- sdkmanager `yes |` pipe approach -- widely used in CI but no official flag documentation found

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all stdlib, no new dependencies needed
- Architecture: HIGH -- follows existing doctor.go patterns exactly
- Pitfalls: HIGH -- well-documented issues with xcode-select, sdkmanager licenses, ANDROID_HOME
- Install methods: MEDIUM -- specific brew cask paths and softwareupdate parsing may vary across macOS versions

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable domain, Homebrew/macOS tooling changes slowly)
