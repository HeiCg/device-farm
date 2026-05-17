package cmd

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"

	"github.com/spf13/cobra"

	"github.com/device-farm/cli/internal/session"
)

var sessionScreenshotCmd = &cobra.Command{
	Use:   "screenshot",
	Short: "Capture a screenshot on the leased device",
	Long: `Dispatch a screenshot envelope over the session WebSocket, then download
the captured bytes to the path passed via -o.

Examples:
  device-farm session screenshot -o current.png`,
	Args: cobra.NoArgs,
	RunE: runSessionScreenshot,
}

func init() {
	sessionScreenshotCmd.Flags().StringP("output", "o", "", "destination file path for PNG bytes (required)")
	_ = sessionScreenshotCmd.MarkFlagRequired("output")
}

func runSessionScreenshot(cmd *cobra.Command, _ []string) error {
	ref, err := resolveSession(cmd)
	if err != nil {
		return err
	}
	outPath, _ := cmd.Flags().GetString("output")

	envelope := map[string]any{"type": "screenshot"}
	result, err := session.SendAction(ref.WSUrl, ref.Token, envelope)
	if err != nil {
		return err
	}

	// ack.result shape per Plan 34-02: {artifactId, url, width, height}.
	res, _ := result["result"].(map[string]any)
	if res == nil {
		return fmt.Errorf("screenshot ack missing result field: %v", result)
	}
	urlStr, _ := res["url"].(string)
	if urlStr == "" {
		return fmt.Errorf("screenshot ack missing result.url: %v", res)
	}

	bytes, err := fetchURL(urlStr, ref.Token)
	if err != nil {
		return fmt.Errorf("fetch screenshot: %w", err)
	}
	if err := os.WriteFile(outPath, bytes, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", outPath, err)
	}

	fmt.Fprintf(cmd.OutOrStdout(), "screenshot saved to %s (%d bytes)\n", outPath, len(bytes))
	return nil
}

// fetchURL retrieves either a file:// URL (local artifact path) or an http(s)
// URL (artifact service). For http(s) the bearer token is attached so the
// artifact endpoint can authorize. Matches the same dual-scheme support as the
// server-side fetchScreenshotBytes helper added in Plan 34-02 (per
// 34-02 SUMMARY decision #7).
func fetchURL(rawURL, token string) ([]byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("parse url: %w", err)
	}
	switch u.Scheme {
	case "file":
		return os.ReadFile(u.Path)
	case "http", "https":
		req, err := http.NewRequest(http.MethodGet, rawURL, nil)
		if err != nil {
			return nil, err
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("artifact fetch %d", resp.StatusCode)
		}
		return io.ReadAll(resp.Body)
	default:
		return nil, fmt.Errorf("unsupported url scheme: %s", u.Scheme)
	}
}
