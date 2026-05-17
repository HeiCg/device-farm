# Phase 4: Go CLI - Research

**Researched:** 2026-03-10
**Domain:** Go CLI application consuming REST API + WebSocket
**Confidence:** HIGH

## Summary

This phase builds a greenfield Go CLI binary (`device-farm`) that consumes the existing Node.js server's REST API and WebSocket streaming endpoints. The CLI targets two user personas: QA engineers running tests interactively from a terminal, and CI pipelines running headless. The server API is fully defined (Phase 2-3 complete) with RFC 7807 errors, cursor-based pagination, multipart uploads, and JSON WebSocket messages.

The Go ecosystem has a mature, well-established stack for CLI tools. Cobra is the industry standard (used by kubectl, docker, gh, hugo) and the clear choice. For WebSocket, the coder/websocket library (maintained fork of nhooyr.io/websocket) provides idiomatic Go with context.Context support throughout. YAML parsing uses the maintained go.yaml.in/yaml/v3 fork. All other needs (HTTP client, multipart, JSON) are handled by Go's standard library.

**Primary recommendation:** Use Cobra + coder/websocket + fatih/color + go.yaml.in/yaml/v3. Structure as `cli/` directory at project root with standard cmd/internal layout. Build produces a single `device-farm` binary.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Compact aligned tables (like kubectl/docker ps) -- column-aligned text with headers, no box-drawing characters
- Colors enabled by default -- green pass, red fail, yellow warning, cyan info. Auto-detect TTY, disable when piped. `--no-color` flag to force off
- Global `--json` flag on all commands -- outputs structured JSON instead of human-readable text
- Unicode status symbols: checkmark passed, X failed, circle pending, filled circle running, warning triangle warning
- `device-farm run` waits and streams by default -- submit, connect WebSocket, stream progress until done, exit with 0/1/2. `--async` flag to return job ID immediately
- Inline step updates -- current step updates in-place, completed steps stay visible (like vitest/pytest). Falls back to log-style append in non-TTY
- Compact summary block at end -- pass/fail counts, total duration, device name, failed flow names with failing step
- `logs --follow` auto-exits with summary when job completes -- no manual Ctrl+C needed, same exit code as `run`
- Config file at `~/.device-farm.yaml` with: server_url, api_key, defaults (platform, timeout, output format)
- `config set/get` subcommands with dot notation for nested values: `config set defaults.platform ios`
- `config list` shows all current values
- API key masked in display -- shows last 4 chars only (e.g., `df_key_***abc3`)
- Single server config -- no profiles/contexts in v1. Override with `--server` flag or env var
- Exit codes: 0 = all tests passed, 1 = test failures, 2 = infrastructure/CLI error (bad config, server unreachable, timeout)
- Environment variables with DEVICE_FARM_ prefix: DEVICE_FARM_URL, DEVICE_FARM_API_KEY, DEVICE_FARM_PLATFORM. Priority: flag > env > config > default
- Full TTY detection: TTY gets colors + inline updates + unicode; non-TTY gets plain text + log-style append + no colors
- `--meta key=value` flags for CI context -- pass metadata (branch, PR, commit) that gets sent with the job submission

### Claude's Discretion
- Go CLI framework choice (cobra, urfave/cli, or stdlib)
- WebSocket client library choice
- YAML parsing library
- HTTP client implementation
- Binary name and build/release setup
- Internal code organization (cmd/, internal/, pkg/)
- Connection timeout and retry logic
- Multipart upload implementation for flow files

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLI-01 | `device-farm run` -- send YAML files, connect WebSocket, stream logs, exit 0/1 | Cobra command + multipart upload (stdlib) + coder/websocket for streaming + inline TTY rendering |
| CLI-02 | `device-farm status <job-id>` -- show status and result | Cobra command + GET /api/jobs/:id + table formatting |
| CLI-03 | `device-farm logs <job-id>` -- logs or --follow for streaming | Cobra command + GET /api/jobs/:id/logs + WebSocket /ws/jobs/:id for --follow |
| CLI-04 | `device-farm devices` -- table with emulator status | Cobra command + GET /api/devices + column-aligned table output |
| CLI-05 | `device-farm cancel <job-id>` -- cancel job | Cobra command + DELETE /api/jobs/:id |
| CLI-06 | `device-farm config set/get` -- configure server URL and defaults | Cobra subcommands + go.yaml.in/yaml/v3 for ~/.device-farm.yaml |
| CLI-07 | CLI authenticates via API key configured locally | Authorization header from config/env, priority: flag > env > config |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| github.com/spf13/cobra | v1.8+ | CLI framework (commands, flags, help, completions) | Industry standard -- kubectl, docker, gh, hugo all use Cobra |
| github.com/coder/websocket | v1.8+ | WebSocket client for job streaming | Maintained fork of nhooyr.io/websocket, idiomatic Go with context.Context |
| go.yaml.in/yaml/v3 | v3.0+ | Config file parsing (~/.device-farm.yaml) | Maintained fork of gopkg.in/yaml.v3 (archived Apr 2025) |
| github.com/fatih/color | v1.18+ | Colored terminal output with TTY auto-detection | De facto standard, auto-disables on non-TTY, respects NO_COLOR |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| golang.org/x/term | latest | TTY detection for inline updates | Detecting terminal capabilities for in-place rendering |
| net/http (stdlib) | - | HTTP client for REST API calls | All REST API interaction, multipart uploads |
| mime/multipart (stdlib) | - | Multipart form data for file uploads | POST /api/jobs file upload |
| encoding/json (stdlib) | - | JSON encode/decode | API request/response, --json flag output |
| fmt (stdlib) | - | Column-aligned table output | Simple tabwriter-style output without box-drawing |
| text/tabwriter (stdlib) | - | Tab-aligned column formatting | Device list, job status tables |
| os/signal (stdlib) | - | Graceful Ctrl+C handling | Clean WebSocket disconnect on interrupt |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Cobra | urfave/cli | urfave is lighter but Cobra has better subcommand support, auto-completions, and industry adoption |
| coder/websocket | gorilla/websocket | gorilla works fine but has no context.Context integration; coder/websocket is more idiomatic |
| text/tabwriter | olekukonko/tablewriter | tablewriter adds box-drawing; user explicitly wants kubectl-style compact tables which tabwriter handles natively |
| go.yaml.in/yaml/v3 | gopkg.in/yaml.v3 | gopkg.in/yaml.v3 is archived/unmaintained since April 2025 |

**Installation:**
```bash
# Initialize Go module in cli/ directory
cd cli && go mod init github.com/device-farm/cli

go get github.com/spf13/cobra@latest
go get github.com/coder/websocket@latest
go get go.yaml.in/yaml/v3@latest
go get github.com/fatih/color@latest
go get golang.org/x/term@latest
```

## Architecture Patterns

### Recommended Project Structure
```
cli/
├── main.go                  # Entry point: calls cmd.Execute()
├── go.mod
├── go.sum
├── cmd/
│   ├── root.go              # Root command, global flags (--server, --json, --no-color, --api-key)
│   ├── run.go               # `run` command: multipart upload + WebSocket streaming
│   ├── status.go            # `status` command: GET /api/jobs/:id
│   ├── logs.go              # `logs` command: GET logs or --follow via WebSocket
│   ├── devices.go           # `devices` command: GET /api/devices
│   ├── cancel.go            # `cancel` command: DELETE /api/jobs/:id
│   ├── config.go            # `config set/get/list` subcommands
│   └── version.go           # `version` command
├── internal/
│   ├── client/
│   │   ├── client.go        # HTTP client wrapper (base URL, auth header, error parsing)
│   │   ├── jobs.go          # Job API methods (create, get, list, cancel, logs)
│   │   ├── devices.go       # Device API methods (list)
│   │   └── health.go        # Health check
│   ├── config/
│   │   ├── config.go        # YAML config load/save/get/set with dot notation
│   │   └── resolve.go       # Priority resolution: flag > env > config > default
│   ├── output/
│   │   ├── table.go         # Column-aligned table renderer (tabwriter)
│   │   ├── json.go          # JSON output mode
│   │   ├── color.go         # Color helpers (status -> color mapping)
│   │   └── symbols.go       # Unicode status symbols with TTY fallback
│   └── streaming/
│       ├── ws.go            # WebSocket connection, message parsing, reconnect
│       ├── renderer.go      # TTY inline step renderer (in-place updates)
│       └── summary.go       # End-of-job summary block
└── Makefile                 # Build targets: build, test, lint, install
```

### Pattern 1: API Client with Error Parsing
**What:** Centralized HTTP client that adds auth headers and parses RFC 7807 errors into Go errors
**When to use:** Every REST API call
**Example:**
```go
// internal/client/client.go
type Client struct {
    BaseURL    string
    APIKey     string
    HTTPClient *http.Client
}

type ProblemDetail struct {
    Type     string `json:"type"`
    Title    string `json:"title"`
    Status   int    `json:"status"`
    Detail   string `json:"detail"`
    Instance string `json:"instance"`
}

func (c *Client) do(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
    req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, body)
    if err != nil {
        return nil, err
    }
    if c.APIKey != "" {
        req.Header.Set("Authorization", "Bearer "+c.APIKey)
    }
    resp, err := c.HTTPClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("server unreachable: %w", err)
    }
    if resp.StatusCode >= 400 {
        defer resp.Body.Close()
        var problem ProblemDetail
        if err := json.NewDecoder(resp.Body).Decode(&problem); err == nil {
            return nil, fmt.Errorf("%s: %s", problem.Title, problem.Detail)
        }
        return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
    }
    return resp, nil
}
```

### Pattern 2: Config Priority Resolution
**What:** Resolve configuration values using flag > env > config > default priority chain
**When to use:** Every command that needs server URL, API key, platform, etc.
**Example:**
```go
// internal/config/resolve.go
func ResolveServerURL(flagValue string) string {
    if flagValue != "" {
        return flagValue
    }
    if env := os.Getenv("DEVICE_FARM_URL"); env != "" {
        return env
    }
    cfg, _ := Load()
    if cfg.ServerURL != "" {
        return cfg.ServerURL
    }
    return "http://localhost:3000"
}
```

### Pattern 3: Output Mode Switching
**What:** Every command checks `--json` flag and switches between human-readable and JSON output
**When to use:** All commands
**Example:**
```go
// In command RunE function
if jsonOutput {
    return json.NewEncoder(os.Stdout).Encode(result)
}
// Human-readable table output
printDeviceTable(result)
```

### Pattern 4: WebSocket Streaming with Context Cancellation
**What:** Connect WebSocket, stream messages, handle Ctrl+C gracefully
**When to use:** `run` command, `logs --follow`
**Example:**
```go
// internal/streaming/ws.go
func StreamJob(ctx context.Context, wsURL string, renderer Renderer) (exitCode int, err error) {
    conn, _, err := websocket.Dial(ctx, wsURL, nil)
    if err != nil {
        return 2, fmt.Errorf("websocket connect: %w", err)
    }
    defer conn.CloseNow()

    for {
        _, data, err := conn.Read(ctx)
        if err != nil {
            if websocket.CloseStatus(err) == websocket.StatusNormalClosure {
                break
            }
            return 2, fmt.Errorf("websocket read: %w", err)
        }
        var msg JobMessage
        if err := json.Unmarshal(data, &msg); err != nil {
            continue
        }
        exitCode = renderer.Handle(msg)
    }
    return exitCode, nil
}
```

### Pattern 5: TTY-Aware Inline Rendering
**What:** Use ANSI escape codes for in-place step updates when TTY is detected, fall back to append mode
**When to use:** `run` command streaming output
**Example:**
```go
// internal/streaming/renderer.go
type Renderer struct {
    isTTY   bool
    writer  io.Writer
}

func (r *Renderer) UpdateStep(step StepData) {
    if r.isTTY {
        // Move cursor up, clear line, rewrite current step
        fmt.Fprintf(r.writer, "\033[1A\033[2K")
        fmt.Fprintf(r.writer, "  %s %s\n", runningSymbol, step.Command)
    } else {
        // Non-TTY: just append
        fmt.Fprintf(r.writer, "[%s] %s: %s\n", step.Status, step.FlowName, step.Command)
    }
}
```

### Anti-Patterns to Avoid
- **Calling os.Exit() deep in code:** Only call os.Exit in main.go. Use error returns throughout commands. os.Exit skips defer statements.
- **Global mutable state for config:** Pass config through structs, not package-level variables. Makes testing possible.
- **Blocking on WebSocket without context:** Always pass context.Context to Dial/Read. Ctrl+C must cancel immediately.
- **Hardcoding output to os.Stdout:** Accept io.Writer in output functions for testability.
- **Ignoring non-TTY mode:** All rendering must degrade gracefully when piped. Use `term.IsTerminal(int(os.Stdout.Fd()))`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI framework | Custom arg parser | Cobra | Subcommands, flags, help, completions, typo suggestions |
| Color output | Manual ANSI codes | fatih/color | TTY detection, NO_COLOR, Windows support |
| WebSocket protocol | Raw TCP + framing | coder/websocket | RFC 6455 compliance, context cancellation, ping/pong |
| YAML config | Custom parser | go.yaml.in/yaml/v3 | Full YAML spec, struct tags, error messages |
| Column alignment | Manual space padding | text/tabwriter (stdlib) | Elastic tabstops, handles variable-width content |
| Multipart upload | Manual boundary encoding | mime/multipart (stdlib) | Correct boundary generation, proper headers |
| TTY detection | Manual ioctl calls | golang.org/x/term | Cross-platform terminal detection |

**Key insight:** Go's standard library covers HTTP, JSON, multipart, and tabwriter. Only reach for external libs where the stdlib genuinely falls short (CLI framework, WebSocket, YAML, color).

## Common Pitfalls

### Pitfall 1: WebSocket Reconnection During Late-Join Replay
**What goes wrong:** CLI connects to WebSocket but misses messages between job submission and WS connection. Or WS disconnects and reconnect replays duplicates.
**Why it happens:** Race between POST /jobs response and WebSocket subscribe.
**How to avoid:** Server already has late-join replay buffer (ring buffer MAX_BUFFER=200). The CLI should connect to WS immediately after job creation. For reconnect, track last-seen message timestamp and skip duplicates.
**Warning signs:** Duplicate log lines in output, or missing initial steps.

### Pitfall 2: Multipart Upload Content-Type Header
**What goes wrong:** Server rejects file upload with 400 error.
**Why it happens:** Content-Type must include the multipart boundary. Go's multipart.Writer generates a random boundary that must be included.
**How to avoid:** Set `Content-Type` to `writer.FormDataContentType()` which includes the boundary.
**Warning signs:** "Invalid YAML" errors when files are valid, or "missing boundary" errors.

### Pitfall 3: Exit Code Handling in Cobra
**What goes wrong:** CLI always exits 0 even on test failures.
**Why it happens:** Cobra's Execute() returns an error but doesn't set exit code. And using os.Exit() in RunE skips cleanup.
**How to avoid:** Have main.go check the error from Execute() and call os.Exit() there. Use a custom error type that carries the exit code (e.g., `ExitError{Code: 1}`).
**Warning signs:** CI pipelines not failing when tests fail.

### Pitfall 4: Cursor-Based Pagination Handling
**What goes wrong:** `status --all` only shows first page of jobs.
**Why it happens:** Server uses cursor pagination, not offset. Must follow `cursor` + `hasMore` fields.
**How to avoid:** Loop fetching pages until `hasMore` is false. Pass returned `cursor` as query param to next request.
**Warning signs:** Only 20 jobs shown when there are hundreds.

### Pitfall 5: Config File Permissions
**What goes wrong:** API key stored in world-readable file.
**Why it happens:** Default file creation permissions are 0644.
**How to avoid:** Create ~/.device-farm.yaml with 0600 permissions. Check and warn if permissions are too open.
**Warning signs:** Security audit flags.

### Pitfall 6: Signal Handling and Graceful Shutdown
**What goes wrong:** Ctrl+C during `run` leaves job running on server, no summary shown.
**Why it happens:** Default SIGINT kills process immediately.
**How to avoid:** Trap SIGINT/SIGTERM with os/signal. On first signal: cancel context (closes WS gracefully), print summary. On second signal: force exit.
**Warning signs:** Orphaned running jobs on server after CLI killed.

### Pitfall 7: Pipe Detection for Color and Unicode
**What goes wrong:** Color escape codes appear in piped output, breaking downstream tools.
**Why it happens:** fatih/color auto-detects but only for its own output. Direct fmt.Printf with unicode symbols still outputs unicode when piped.
**How to avoid:** Check TTY once at startup, pass boolean through to all rendering. Use fatih/color's `NoColor` global AND check term.IsTerminal for symbol selection.
**Warning signs:** `device-farm status | grep` shows garbage characters.

## Code Examples

### Multipart Job Submission
```go
// internal/client/jobs.go
func (c *Client) CreateJob(ctx context.Context, files []string, platform string, metadata map[string]string) (*Job, error) {
    var buf bytes.Buffer
    writer := multipart.NewWriter(&buf)

    // Add YAML files
    for _, fpath := range files {
        f, err := os.Open(fpath)
        if err != nil {
            return nil, fmt.Errorf("open %s: %w", fpath, err)
        }
        part, err := writer.CreateFormFile("files", filepath.Base(fpath))
        if err != nil {
            f.Close()
            return nil, err
        }
        if _, err := io.Copy(part, f); err != nil {
            f.Close()
            return nil, err
        }
        f.Close()
    }

    // Add platform field
    writer.WriteField("platform", platform)

    // Add metadata as JSON
    if len(metadata) > 0 {
        metaJSON, _ := json.Marshal(metadata)
        writer.WriteField("metadata", string(metaJSON))
    }
    writer.Close()

    req, err := http.NewRequestWithContext(ctx, "POST", c.BaseURL+"/api/jobs", &buf)
    if err != nil {
        return nil, err
    }
    req.Header.Set("Content-Type", writer.FormDataContentType())
    if c.APIKey != "" {
        req.Header.Set("Authorization", "Bearer "+c.APIKey)
    }

    resp, err := c.HTTPClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("server unreachable: %w", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != 201 {
        return nil, c.parseError(resp)
    }

    var job Job
    json.NewDecoder(resp.Body).Decode(&job)
    return &job, nil
}
```

### WebSocket Job Message Types (matching server protocol)
```go
// internal/streaming/types.go
type WsMessageType string

const (
    MsgLog     WsMessageType = "log"
    MsgStep    WsMessageType = "step"
    MsgMetrics WsMessageType = "metrics"
    MsgStatus  WsMessageType = "status"
    MsgLogcat  WsMessageType = "logcat"
)

type JobMessage struct {
    Type      WsMessageType   `json:"type"`
    Data      json.RawMessage `json:"data"`
    Timestamp string          `json:"timestamp"`
}

type LogData struct {
    Line   string `json:"line"`
    Stream string `json:"stream"` // "stdout" or "stderr"
}

type StepData struct {
    FlowName   string `json:"flowName"`
    Command    *string `json:"command"`
    Status     string `json:"status"`
    DurationMs *int   `json:"durationMs"`
}

type StatusData struct {
    Status string `json:"status"` // "running", "passed", "failed", "cancelled", "timeout"
}
```

### Config File Structure
```go
// internal/config/config.go
type Config struct {
    ServerURL string   `yaml:"server_url"`
    APIKey    string   `yaml:"api_key"`
    Defaults  Defaults `yaml:"defaults"`
}

type Defaults struct {
    Platform string `yaml:"platform"`
    Timeout  int    `yaml:"timeout"`
    Format   string `yaml:"format"` // "text" or "json"
}

func configPath() string {
    home, _ := os.UserHomeDir()
    return filepath.Join(home, ".device-farm.yaml")
}

func Load() (*Config, error) {
    data, err := os.ReadFile(configPath())
    if err != nil {
        if os.IsNotExist(err) {
            return &Config{}, nil
        }
        return nil, err
    }
    var cfg Config
    if err := yaml.Unmarshal(data, &cfg); err != nil {
        return nil, fmt.Errorf("invalid config: %w", err)
    }
    return &cfg, nil
}

func Save(cfg *Config) error {
    data, err := yaml.Marshal(cfg)
    if err != nil {
        return err
    }
    return os.WriteFile(configPath(), data, 0600)
}
```

### Cobra Root Command with Global Flags
```go
// cmd/root.go
var (
    serverFlag  string
    apiKeyFlag  string
    jsonOutput  bool
    noColor     bool
)

var rootCmd = &cobra.Command{
    Use:   "device-farm",
    Short: "CLI for Device Farm - run Maestro tests on managed emulators",
    PersistentPreRun: func(cmd *cobra.Command, args []string) {
        if noColor {
            color.NoColor = true
        }
    },
}

func init() {
    rootCmd.PersistentFlags().StringVar(&serverFlag, "server", "", "Server URL (overrides config and DEVICE_FARM_URL)")
    rootCmd.PersistentFlags().StringVar(&apiKeyFlag, "api-key", "", "API key (overrides config and DEVICE_FARM_API_KEY)")
    rootCmd.PersistentFlags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
    rootCmd.PersistentFlags().BoolVar(&noColor, "no-color", false, "Disable colored output")
}

func Execute() error {
    return rootCmd.Execute()
}
```

### Compact Table Output (kubectl-style)
```go
// internal/output/table.go
func PrintDeviceTable(w io.Writer, devices []Device, isTTY bool) {
    tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
    fmt.Fprintln(tw, "NAME\tPLATFORM\tSTATUS\tCURRENT JOB")
    for _, d := range devices {
        status := formatStatus(d.Status, isTTY)
        jobID := d.CurrentJobID
        if jobID == "" {
            jobID = "-"
        }
        fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", d.Name, d.Type, status, jobID)
    }
    tw.Flush()
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| gopkg.in/yaml.v3 | go.yaml.in/yaml/v3 | Apr 2025 | Old package archived, use maintained fork |
| nhooyr.io/websocket | github.com/coder/websocket | 2024 | Coder took over maintenance, same API |
| gorilla/websocket (briefly unmaintained) | gorilla/websocket (re-maintained) OR coder/websocket | 2023-2024 | gorilla works but coder/websocket is more idiomatic Go |
| Manual --help | Cobra auto-generated help + completions | stable | Shell completions for bash/zsh/fish/powershell out of the box |

**Deprecated/outdated:**
- gopkg.in/yaml.v3: Archived April 2025, use go.yaml.in/yaml/v3
- nhooyr.io/websocket: Replaced by github.com/coder/websocket (same maintainer, new org)

## Open Questions

1. **Go installation on build machine**
   - What we know: `go version` returns "Go not found" on the current machine
   - What's unclear: Whether Go needs to be installed as part of this phase or is a prerequisite
   - Recommendation: Document Go 1.22+ as a prerequisite. First task should validate Go is available or provide install instructions.

2. **Binary distribution strategy**
   - What we know: CLI should build to a single binary named `device-farm`
   - What's unclear: Whether to use goreleaser, manual Makefile, or just `go build`
   - Recommendation: Start with a simple Makefile. Goreleaser is nice but out of scope for v1 -- add it when release automation is needed.

3. **Server API authentication header format**
   - What we know: CLI-07 says "authenticates via API key" and AUTH phase is Phase 6
   - What's unclear: Exact header format (Authorization: Bearer vs X-API-Key)
   - Recommendation: Use `Authorization: Bearer <key>` as standard. Server can validate in Phase 6. CLI sends it now if configured.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Go testing (stdlib) + go test |
| Config file | None needed -- Go test is zero-config |
| Quick run command | `cd cli && go test ./... -short -count=1` |
| Full suite command | `cd cli && go test ./... -v -count=1 -race` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLI-01 | run command creates job via multipart, streams via WS | unit + integration | `cd cli && go test ./cmd/ -run TestRun -v` | No -- Wave 0 |
| CLI-02 | status command fetches and displays job | unit | `cd cli && go test ./cmd/ -run TestStatus -v` | No -- Wave 0 |
| CLI-03 | logs command fetches logs, --follow streams via WS | unit | `cd cli && go test ./cmd/ -run TestLogs -v` | No -- Wave 0 |
| CLI-04 | devices command lists devices in table format | unit | `cd cli && go test ./cmd/ -run TestDevices -v` | No -- Wave 0 |
| CLI-05 | cancel command sends DELETE | unit | `cd cli && go test ./cmd/ -run TestCancel -v` | No -- Wave 0 |
| CLI-06 | config set/get/list manages YAML file | unit | `cd cli && go test ./internal/config/ -run Test -v` | No -- Wave 0 |
| CLI-07 | API key sent in Authorization header | unit | `cd cli && go test ./internal/client/ -run TestAuth -v` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `cd cli && go test ./... -short -count=1`
- **Per wave merge:** `cd cli && go test ./... -v -count=1 -race`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `cli/go.mod` -- Go module initialization
- [ ] `cli/internal/client/client_test.go` -- HTTP client with mock server (httptest)
- [ ] `cli/internal/config/config_test.go` -- Config load/save/set/get
- [ ] `cli/internal/output/table_test.go` -- Table formatting
- [ ] `cli/internal/streaming/ws_test.go` -- WebSocket message parsing
- [ ] `cli/cmd/root_test.go` -- Root command and global flag parsing

## Sources

### Primary (HIGH confidence)
- [spf13/cobra on GitHub](https://github.com/spf13/cobra) - CLI framework, latest v1.8+, used by kubectl/docker/gh
- [coder/websocket on GitHub](https://github.com/coder/websocket) - Maintained fork of nhooyr.io/websocket, idiomatic Go API
- [fatih/color on GitHub](https://github.com/fatih/color) - Color output with TTY detection, NO_COLOR support, v1.18+
- [go.yaml.in/yaml/v3 on pkg.go.dev](https://pkg.go.dev/go.yaml.in/yaml/v3) - Maintained YAML v3 fork
- Server source code: `server/api/routes.ts`, `server/api/error-handler.ts`, `server/streaming/types.ts`, `server/streaming/websocket-plugin.ts` - Exact API contract

### Secondary (MEDIUM confidence)
- [Building CLI Apps with Cobra & Viper](https://www.glukhov.org/post/2025/11/go-cli-applications-with-cobra-and-viper/) - Project structure patterns
- [Go Forum: WebSocket in 2025](https://forum.golangbridge.org/t/websocket-in-2025/38671) - Library comparison discussion
- [Go Project Structure Practices](https://www.glukhov.org/post/2025/12/go-project-structure/) - cmd/internal/pkg layout guidance

### Tertiary (LOW confidence)
- Go version availability on target machine -- needs validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Cobra, coder/websocket, fatih/color are well-established with active maintenance
- Architecture: HIGH - cmd/internal pattern is standard Go, server API contract fully inspected from source
- Pitfalls: HIGH - WebSocket, multipart, exit codes are well-documented problem areas in Go CLI tools

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable ecosystem, 30-day validity)
