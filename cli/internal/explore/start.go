// Package explore implements the `device-farm explore` HTTP/WS client.
//
// Phase 35 Plan 35-04 (T-35.5) — wraps the REST + WS surfaces shipped in
// 35-01 (POST /api/explorations) and 35-03 (GET /api/explorations/:id/events).
//
// Split into two files:
//   - start.go : APK artifact upload + POST /api/explorations + bundle-id auto-detect.
//   - stream.go: WS open + event loop + human-readable formatter + exit-code mapping.
//
// This file ships the START path. The CLI dispatches as:
//
//	resp, err := explore.StartExploration(serverURL, apiKey, explore.StartOpts{...})
//	if err != nil { os.Exit(2) }
//	os.Exit(explore.StreamEvents(explore.StreamOpts{WSURL: resp.AgentLogStreamURL, ...}))
package explore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// StartOpts mirrors the explore Cobra flag set. Defaults are applied by the
// caller (cli/cmd/explore.go) so this struct accepts only resolved values.
type StartOpts struct {
	APKPath        string
	BundleID       string // optional — auto-detected via aapt/plutil when empty
	Platform       string // "android" | "ios"
	BudgetTaps     int
	BudgetScreens  int
	BudgetSeconds  int
	SeedSkeletonID string // optional — Phase 34 iOS skeleton UUID
	Model          string // "claude-sonnet-4-5" | "claude-opus-4-7"
}

// StartResponse mirrors server/explorations/schemas.ts startResponseSchema.
// All five fields are required on a 201 response.
type StartResponse struct {
	RunID                string `json:"runId"`
	SessionID            string `json:"sessionId"`
	DeviceID             string `json:"deviceId"`
	AgentLogStreamURL    string `json:"agentLogStreamUrl"`
	EstimatedDurationMin int    `json:"estimatedDurationMin"`
}

// httpDoer abstracts http.Client so tests can inject custom transports.
type httpDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// StartExploration uploads the APK and POSTs to /api/explorations.
//
// Returns the StartResponse on 201. Returns an error (suitable for
// os.Stderr printing + os.Exit(2)) on any failure: bundle-id detection,
// upload failure, POST failure, decode failure.
//
// serverURL must include scheme + host (e.g. "http://localhost:3000").
// apiKey is sent as Bearer in the Authorization header on both calls;
// empty apiKey is allowed (server-side auth gate will 401 in that case).
func StartExploration(serverURL, apiKey string, opts StartOpts) (*StartResponse, error) {
	return startExplorationWithClient(http.DefaultClient, serverURL, apiKey, opts)
}

func startExplorationWithClient(client httpDoer, serverURL, apiKey string, opts StartOpts) (*StartResponse, error) {
	// Validate APK path early — bundle-id detection also opens the file but
	// surfacing "file not found" before subprocess spawn gives a cleaner UX.
	if opts.APKPath == "" {
		return nil, errors.New("--apk is required")
	}
	if _, err := os.Stat(opts.APKPath); err != nil {
		return nil, fmt.Errorf("APK file %s not accessible: %w", opts.APKPath, err)
	}

	// 1. Resolve bundle ID if omitted.
	if opts.BundleID == "" {
		id, err := detectBundleID(opts.APKPath, opts.Platform)
		if err != nil {
			return nil, fmt.Errorf("--bundle-id required (auto-detection failed: %w)", err)
		}
		opts.BundleID = id
	}

	// 2. Upload APK as artifact.
	artifactID, err := uploadArtifact(client, serverURL, apiKey, opts.APKPath, opts.Platform)
	if err != nil {
		return nil, fmt.Errorf("upload artifact: %w", err)
	}

	// 3. POST /api/explorations.
	body := map[string]any{
		"appArtifactId": artifactID,
		"platform":      opts.Platform,
		"bundleId":      opts.BundleID,
		"budgetTaps":    opts.BudgetTaps,
		"budgetScreens": opts.BudgetScreens,
		"budgetSeconds": opts.BudgetSeconds,
		"model":         opts.Model,
	}
	if opts.SeedSkeletonID != "" {
		body["seedSkeletonId"] = opts.SeedSkeletonID
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request body: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", serverURL+"/api/explorations", bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("POST exploration: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("POST /api/explorations returned %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	var out StartResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &out, nil
}

// uploadArtifact uploads the APK via multipart POST to /api/artifacts.
// Form fields:
//   - file     : multipart file
//   - platform : "android" | "ios"
//   - type     : "app"
//
// NOTE (deferred): the server-side `POST /api/artifacts` endpoint is NOT
// shipped yet — artifacts are currently created server-internally by the
// jobs upload pipeline (server/api/routes.ts). The CLI implements the
// expected contract per the 35-04 plan; adding the standalone endpoint is
// tracked in deferred-items.md (Plan 35-06 phase close picks it up).
func uploadArtifact(client httpDoer, serverURL, apiKey, path, platform string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open APK: %w", err)
	}
	defer f.Close()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", filepath.Base(path))
	if err != nil {
		return "", fmt.Errorf("create form file: %w", err)
	}
	if _, err := io.Copy(part, f); err != nil {
		return "", fmt.Errorf("copy APK body: %w", err)
	}
	if err := w.WriteField("platform", platform); err != nil {
		return "", fmt.Errorf("write platform field: %w", err)
	}
	if err := w.WriteField("type", "app"); err != nil {
		return "", fmt.Errorf("write type field: %w", err)
	}
	if err := w.Close(); err != nil {
		return "", fmt.Errorf("close multipart writer: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", serverURL+"/api/artifacts", &buf)
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("upload: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("upload returned %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	var out struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("decode upload response: %w", err)
	}
	if out.ID == "" {
		return "", errors.New("upload response missing id field")
	}
	return out.ID, nil
}

// detectBundleID extracts the application id from an APK/IPA on disk.
//
// Android : runs `aapt dump badging <apk>` and scrapes `package: name='...'`.
// iOS     : unzips Info.plist from the IPA and runs `plutil -extract CFBundleIdentifier raw -`.
//
// Returns a helpful error mentioning the missing tool when the subprocess
// is not available on PATH (so the user knows to either install the tool
// or pass --bundle-id explicitly).
func detectBundleID(path, platform string) (string, error) {
	switch platform {
	case "android":
		if _, lookErr := exec.LookPath("aapt"); lookErr != nil {
			return "", fmt.Errorf("aapt not in PATH (install Android SDK build-tools, or pass --bundle-id)")
		}
		out, err := exec.Command("aapt", "dump", "badging", path).Output()
		if err != nil {
			return "", fmt.Errorf("aapt dump badging: %w", err)
		}
		re := regexp.MustCompile(`package: name='([^']+)'`)
		m := re.FindStringSubmatch(string(out))
		if m == nil {
			return "", errors.New("aapt output did not contain `package: name='...'`")
		}
		return m[1], nil

	case "ios":
		if _, lookErr := exec.LookPath("unzip"); lookErr != nil {
			return "", fmt.Errorf("unzip not in PATH (or pass --bundle-id)")
		}
		if _, lookErr := exec.LookPath("plutil"); lookErr != nil {
			return "", fmt.Errorf("plutil not in PATH (macOS-only; pass --bundle-id on Linux)")
		}
		// Pipe `unzip -p` → `plutil -extract` without spawning a shell. The IPA
		// path is passed as a positional argv element (NOT interpolated into a
		// shell command string), so a malicious filename cannot trigger
		// command injection. The "*/Info.plist" wildcard is interpreted by
		// unzip's own internal matcher, not by the shell.
		unzipCmd := exec.Command("unzip", "-p", path, "*/Info.plist")
		plutilCmd := exec.Command("plutil", "-extract", "CFBundleIdentifier", "raw", "-")
		pipe, err := unzipCmd.StdoutPipe()
		if err != nil {
			return "", fmt.Errorf("create unzip stdout pipe: %w", err)
		}
		plutilCmd.Stdin = pipe
		var stdout bytes.Buffer
		plutilCmd.Stdout = &stdout
		if err := plutilCmd.Start(); err != nil {
			return "", fmt.Errorf("start plutil: %w", err)
		}
		if err := unzipCmd.Run(); err != nil {
			// unzip may exit non-zero if entry missing; surface plutil's error if any.
			_ = plutilCmd.Wait()
			return "", fmt.Errorf("unzip Info.plist: %w", err)
		}
		if err := plutilCmd.Wait(); err != nil {
			return "", fmt.Errorf("plutil -extract CFBundleIdentifier: %w", err)
		}
		id := strings.TrimSpace(stdout.String())
		if id == "" {
			return "", errors.New("CFBundleIdentifier not found in IPA Info.plist")
		}
		return id, nil

	default:
		return "", fmt.Errorf("unknown platform: %s (expected android|ios)", platform)
	}
}
