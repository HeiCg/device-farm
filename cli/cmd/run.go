package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"

	"github.com/device-farm/cli/internal/client"
	"github.com/device-farm/cli/internal/config"
	"github.com/device-farm/cli/internal/streaming"
	"github.com/spf13/cobra"
)

var (
	runPlatform string
	runAsync    bool
	runTimeout  int
	runMeta     []string
	runEnv      []string
	runApk      string
	// Phase 31 / Plan 31-03 / SC3 — per-job emulator boot options.
	// flagAudio uses inverse semantics: default false means "audio disabled"
	// (server adds -no-audio); --audio sets it true → server omits -no-audio.
	// This maps cleanly to Cobra's BoolVar default-false convention and avoids
	// the tristate trap of a `--no-audio=false` flag.
	runColdBoot bool
	runAudio    bool
	// Phase 37 Plan 37-03 Track C — GitHub PR association.
	// When runGithubPr > 0, the CLI emits github_pr_id + github_repo_owner +
	// github_repo_name on the multipart submission so the server can correlate
	// the run to a PR and post/update a status comment.
	runGithubPr   int
	runGithubRepo string
	// Phase 37 Plan 37-04 Track D — parallel-deploy flags.
	// --parallel N enables build-once-deploy-N: the same APK is installed
	// on N devices in parallel via runParallelDeploy. --broadcast-input
	// additionally mirrors tap/key events from a primary session to the
	// fan-out targets via /api/sessions/broadcast.
	runParallel      int
	runBroadcastIn   bool
)

var runCmd = &cobra.Command{
	Use:   "run [flags] <flow.yaml> [flow2.yaml ...]",
	Short: "Submit and run Maestro test flows",
	Long:  "Submit flow YAML files to the Device Farm server and stream execution results in real time.",
	Args:  cobra.MinimumNArgs(1),
	RunE:  runRun,
}

func init() {
	runCmd.Flags().StringVar(&runPlatform, "platform", "", "Target platform (android/ios)")
	runCmd.Flags().BoolVar(&runAsync, "async", false, "Return job ID immediately without streaming")
	runCmd.Flags().IntVar(&runTimeout, "timeout", 0, "Job timeout in seconds")
	runCmd.Flags().StringSliceVar(&runMeta, "meta", nil, "Metadata key=value pairs (can be repeated)")
	runCmd.Flags().StringSliceVarP(&runEnv, "env", "e", nil, "Environment variables for Maestro (e.g. -e APP_ID=com.app)")
	runCmd.Flags().StringVar(&runApk, "apk", "", "Path to APK file to install before running tests")
	// Phase 31 / Plan 31-03 / SC3 — per-job emulator boot options.
	runCmd.Flags().BoolVar(&runColdBoot, "cold-boot", false, "Boot emulator without snapshot reuse (slower but clean state)")
	runCmd.Flags().BoolVar(&runAudio, "audio", false, "Enable emulator audio (default: audio is suppressed)")
	// Phase 37 Plan 37-03 Track C — GitHub PR association flags.
	runCmd.Flags().IntVar(&runGithubPr, "github-pr", 0, "GitHub PR number to associate with this run (server posts/updates a status comment)")
	runCmd.Flags().StringVar(&runGithubRepo, "github-repo", "", "GitHub repository in owner/name form (auto-detected from `git remote get-url origin` when --github-pr is set and this flag is empty)")
	// Phase 37 Plan 37-04 Track D — parallel-deploy flags.
	runCmd.Flags().IntVar(&runParallel, "parallel", 0, "Number of devices to fan out to (parallel-deploy mode). 0 = single-device. Server enforces config.pool.<platform>.max_parallelism cap.")
	runCmd.Flags().BoolVar(&runBroadcastIn, "broadcast-input", false, "Mirror tap/key/text events across all parallel sessions (requires --parallel)")
	rootCmd.AddCommand(runCmd)
}

// Phase 37 Plan 37-03 Track C — parse `owner/name` from a github remote URL.
// Supports both ssh (git@github.com:owner/name.git) and https
// (https://github.com/owner/name.git) forms.
var githubRemoteRe = regexp.MustCompile(`github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?$`)

// resolveGithubRepo returns the explicit --github-repo flag value when set,
// or auto-detects it from `git remote get-url origin`. Returns ("", nil) when
// no PR association is requested. Returns an error only when --github-pr is
// set but the repo cannot be resolved.
func resolveGithubRepo(prNumber int, explicit string) (string, error) {
	if prNumber <= 0 {
		return "", nil
	}
	if explicit != "" {
		return explicit, nil
	}
	out, err := exec.Command("git", "remote", "get-url", "origin").Output()
	if err != nil {
		return "", fmt.Errorf("--github-pr requires --github-repo (could not auto-detect from `git remote get-url origin`: %w)", err)
	}
	url := strings.TrimSpace(string(out))
	m := githubRemoteRe.FindStringSubmatch(url)
	if m == nil {
		return "", fmt.Errorf("--github-pr requires --github-repo (origin remote %q is not a github.com URL)", url)
	}
	return m[1] + "/" + m[2], nil
}

func runRun(cmd *cobra.Command, args []string) error {
	// Expand directories and validate file paths
	var fileEntries []client.FileEntry
	for _, f := range args {
		info, err := os.Stat(f)
		if err != nil {
			return &client.ExitError{Code: 2, Message: fmt.Sprintf("file %s not found: %v", f, err)}
		}
		if info.IsDir() {
			// Recursively collect .yaml/.yml files from directory
			baseDir := f
			err := filepath.Walk(baseDir, func(path string, fi os.FileInfo, walkErr error) error {
				if walkErr != nil {
					return walkErr
				}
				if fi.IsDir() {
					return nil
				}
				ext := strings.ToLower(filepath.Ext(path))
				if ext == ".yaml" || ext == ".yml" {
					rel, _ := filepath.Rel(baseDir, path)
					fileEntries = append(fileEntries, client.FileEntry{
						LocalPath:    path,
						RelativePath: rel,
					})
				}
				return nil
			})
			if err != nil {
				return &client.ExitError{Code: 2, Message: fmt.Sprintf("walking directory %s: %v", f, err)}
			}
		} else {
			ext := strings.ToLower(filepath.Ext(f))
			if ext != ".yaml" && ext != ".yml" {
				return &client.ExitError{Code: 2, Message: fmt.Sprintf("file %s is not a YAML file", f)}
			}
			fileEntries = append(fileEntries, client.FileEntry{
				LocalPath:    f,
				RelativePath: filepath.Base(f),
			})
			// Also collect referenced sub-flows (runFlow: paths) from the YAML
			baseDir := filepath.Dir(f)
			subFlows := collectSubFlows(f, baseDir)
			fileEntries = append(fileEntries, subFlows...)
		}
	}

	if len(fileEntries) == 0 {
		return &client.ExitError{Code: 2, Message: "no YAML files found"}
	}

	// Parse metadata
	metadata := make(map[string]string)
	for _, m := range runMeta {
		key, value, ok := strings.Cut(m, "=")
		if !ok {
			return &client.ExitError{Code: 2, Message: fmt.Sprintf("invalid metadata format %q, expected key=value", m)}
		}
		metadata[key] = value
	}

	// Phase 37 Plan 37-04 Track D — parallel-deploy metadata.
	// When --parallel > 0, emit mode=parallel-deploy + parallelism + broadcastInput
	// so the server's POST /api/jobs route enforces the per-platform cap
	// (Pitfall 9) and the executor branches into runParallelDeploy.
	if runParallel > 0 {
		if runParallel < 2 {
			return &client.ExitError{Code: 2, Message: "--parallel must be 0 (single-device) or >= 2"}
		}
		metadata["mode"] = "parallel-deploy"
		metadata["parallelism"] = fmt.Sprintf("%d", runParallel)
		if runBroadcastIn {
			metadata["broadcastInput"] = "true"
		}
	} else if runBroadcastIn {
		return &client.ExitError{Code: 2, Message: "--broadcast-input requires --parallel >= 2"}
	}

	// Phase 37 Plan 37-03 Track C — GitHub PR association metadata.
	// Server resolves the matching installation_id from config.github.pr_integrations
	// when both owner/name match; CLI only needs to forward the PR number + repo.
	if runGithubPr > 0 {
		repo, err := resolveGithubRepo(runGithubPr, runGithubRepo)
		if err != nil {
			return &client.ExitError{Code: 2, Message: err.Error()}
		}
		owner, name, ok := strings.Cut(repo, "/")
		if !ok || owner == "" || name == "" {
			return &client.ExitError{Code: 2, Message: fmt.Sprintf("--github-repo %q must be in owner/name form", repo)}
		}
		metadata["github_pr_id"] = fmt.Sprintf("%d", runGithubPr)
		metadata["github_repo_owner"] = owner
		metadata["github_repo_name"] = name
	}

	// Parse env vars
	envVars := make(map[string]string)
	for _, e := range runEnv {
		key, value, ok := strings.Cut(e, "=")
		if !ok {
			return &client.ExitError{Code: 2, Message: fmt.Sprintf("invalid env format %q, expected KEY=VALUE", e)}
		}
		envVars[key] = value
	}

	// Validate APK path if provided
	if runApk != "" {
		if _, err := os.Stat(runApk); err != nil {
			return &client.ExitError{Code: 2, Message: fmt.Sprintf("APK file %s not found: %v", runApk, err)}
		}
	}

	// Resolve config
	serverURL := config.ResolveServerURL(ServerFlag)
	apiKey := config.ResolveAPIKey(APIKeyFlag)
	platform := config.ResolvePlatform(runPlatform)

	c := client.NewClient(serverURL, apiKey)

	ctx, cancel := context.WithCancel(cmd.Context())
	defer cancel()

	// Phase 31 / Plan 31-03 / SC3 — build per-job boot options only when at
	// least one flag is non-default, so the multipart `boot_options` field is
	// omitted when the operator did not opt in and the server's documented
	// defaults apply. runAudio uses inverse semantics: false = audio
	// suppressed (server default).
	var bootOpts *client.BootOptionsJSON
	if runColdBoot || runAudio {
		bootOpts = &client.BootOptionsJSON{
			ColdBoot: runColdBoot,
			NoAudio:  !runAudio,
			// Gpu omitted — server default applies.
		}
	}

	// Create job
	job, err := c.CreateJob(ctx, fileEntries, platform, metadata, envVars, runApk, bootOpts)
	if err != nil {
		return err
	}

	// Async mode: print job ID and exit
	jobURL := serverURL + "/jobs/" + job.ID
	if runAsync {
		if JSONOutput {
			return json.NewEncoder(os.Stdout).Encode(map[string]string{"jobId": job.ID, "url": jobURL})
		}
		fmt.Fprintf(os.Stdout, "Job %s created\n", job.ID)
		fmt.Fprintf(os.Stderr, "View live: %s\n", jobURL)
		return nil
	}

	// Streaming mode
	fmt.Fprintf(os.Stderr, "Job %s created, connecting...\n", job.ID)
	fmt.Fprintf(os.Stderr, "View live: %s\n", jobURL)

	// Signal handling: first Ctrl+C cancels gracefully, second force-exits
	sigCh := make(chan os.Signal, 2)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		cancel()
		<-sigCh
		os.Exit(2)
	}()

	// Build WebSocket URL
	wsURL := buildWSURL(serverURL, "/ws/jobs/"+job.ID, apiKey)

	renderer := streaming.NewRenderer(os.Stdout, IsTTY)
	exitCode, _, err := streaming.StreamJob(ctx, wsURL, renderer)
	if err != nil {
		// On Ctrl+C, still print summary
		if ctx.Err() != nil {
			streaming.PrintSummary(os.Stdout, renderer.Summary(), IsTTY)
			return &client.ExitError{Code: 2, Message: "interrupted"}
		}
		return &client.ExitError{Code: 2, Message: fmt.Sprintf("streaming error: %v", err)}
	}

	streaming.PrintSummary(os.Stdout, renderer.Summary(), IsTTY)

	if exitCode != 0 {
		return &client.ExitError{Code: exitCode, Message: ""}
	}
	return nil
}

// collectSubFlows scans a YAML file for "runFlow:" references and returns
// FileEntry items for each referenced sub-flow, recursively. Paths are relative
// to baseDir so the server recreates the correct directory structure.
func collectSubFlows(yamlPath, baseDir string) []client.FileEntry {
	seen := make(map[string]bool)
	var entries []client.FileEntry
	collectSubFlowsRecursive(yamlPath, baseDir, seen, &entries)
	return entries
}

func collectSubFlowsRecursive(yamlPath, baseDir string, seen map[string]bool, entries *[]client.FileEntry) {
	data, err := os.ReadFile(yamlPath)
	if err != nil {
		return
	}

	parentDir := filepath.Dir(yamlPath)
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "- runFlow:") {
			continue
		}
		refPath := strings.TrimSpace(strings.TrimPrefix(trimmed, "- runFlow:"))
		if refPath == "" {
			continue
		}

		absPath := filepath.Join(parentDir, refPath)
		absPath, err := filepath.Abs(absPath)
		if err != nil {
			continue
		}

		if seen[absPath] {
			continue
		}
		seen[absPath] = true

		if _, err := os.Stat(absPath); err != nil {
			continue
		}

		rel, err := filepath.Rel(baseDir, absPath)
		if err != nil {
			continue
		}

		*entries = append(*entries, client.FileEntry{
			LocalPath:    absPath,
			RelativePath: rel,
		})

		// Recurse into the sub-flow to find nested runFlow references
		collectSubFlowsRecursive(absPath, baseDir, seen, entries)
	}
}

// buildWSURL replaces http(s):// with ws(s):// and appends the path.
// If apiKey is non-empty, appends ?token=<apiKey> for WebSocket authentication.
func buildWSURL(serverURL, path, apiKey string) string {
	wsURL := serverURL
	if strings.HasPrefix(wsURL, "https://") {
		wsURL = "wss://" + wsURL[len("https://"):]
	} else if strings.HasPrefix(wsURL, "http://") {
		wsURL = "ws://" + wsURL[len("http://"):]
	}
	wsURL = wsURL + path
	if apiKey != "" {
		wsURL += "?token=" + apiKey
	}
	return wsURL
}
