package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/device-farm/cli/internal/client"
	"github.com/device-farm/cli/internal/config"
	"github.com/device-farm/cli/internal/streaming"
	"github.com/spf13/cobra"
)

var logsFollow bool

var logsCmd = &cobra.Command{
	Use:   "logs <job-id>",
	Short: "Fetch or stream job logs",
	Long:  "Fetch complete logs for a job, or stream them in real time with --follow.",
	Args:  cobra.ExactArgs(1),
	RunE:  runLogs,
}

func init() {
	logsCmd.Flags().BoolVarP(&logsFollow, "follow", "f", false, "Stream logs in real time via WebSocket")
	rootCmd.AddCommand(logsCmd)
}

func runLogs(cmd *cobra.Command, args []string) error {
	jobID := args[0]

	serverURL := config.ResolveServerURL(ServerFlag)
	apiKey := config.ResolveAPIKey(APIKeyFlag)
	c := client.NewClient(serverURL, apiKey)

	ctx, cancel := context.WithCancel(cmd.Context())
	defer cancel()

	if !logsFollow {
		return fetchLogs(ctx, c, jobID, os.Stdout)
	}

	return followLogs(ctx, cancel, c, serverURL, jobID, apiKey)
}

// fetchLogs retrieves completed logs via GET /api/jobs/:id/logs.
func fetchLogs(ctx context.Context, c *client.Client, jobID string, w io.Writer) error {
	logs, err := c.GetJobLogs(ctx, jobID)
	if err != nil {
		return err
	}

	if JSONOutput {
		return json.NewEncoder(w).Encode(map[string]string{"logs": logs})
	}

	fmt.Fprint(w, logs)
	return nil
}

// followLogs streams logs via WebSocket with auto-exit on job completion.
func followLogs(ctx context.Context, cancel context.CancelFunc, c *client.Client, serverURL, jobID, apiKey string) error {
	_ = c // client not needed for WebSocket, but kept for consistency

	// Signal handling
	sigCh := make(chan os.Signal, 2)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		cancel()
		<-sigCh
		os.Exit(2)
	}()

	wsURL := buildWSURL(serverURL, "/ws/jobs/"+jobID, apiKey)

	handler := &logOnlyHandler{w: os.Stdout}
	exitCode, _, err := streaming.StreamJob(ctx, wsURL, handler)
	if err != nil {
		if ctx.Err() != nil {
			streaming.PrintSummary(os.Stdout, handler.summary(), IsTTY)
			return &client.ExitError{Code: 2, Message: "interrupted"}
		}
		return &client.ExitError{Code: 2, Message: fmt.Sprintf("streaming error: %v", err)}
	}

	streaming.PrintSummary(os.Stdout, handler.summary(), IsTTY)

	if exitCode != 0 {
		return &client.ExitError{Code: exitCode, Message: ""}
	}
	return nil
}

// logOnlyHandler prints log lines without step rendering.
type logOnlyHandler struct {
	w           io.Writer
	finalStatus string
	passed      int
	failed      int
	skipped     int
}

func (h *logOnlyHandler) HandleLog(d streaming.LogData) {
	fmt.Fprintln(h.w, d.Line)
}

func (h *logOnlyHandler) HandleStep(d streaming.StepData) {
	if d.Status == "running" {
		return
	}
	switch d.Status {
	case "passed":
		h.passed++
	case "failed":
		h.failed++
	default:
		h.skipped++
	}
}

func (h *logOnlyHandler) HandleStatus(d streaming.StatusData) {
	h.finalStatus = d.Status
}

func (h *logOnlyHandler) HandleMetrics(_ streaming.MetricsData) {}

func (h *logOnlyHandler) summary() *streaming.JobSummary {
	return &streaming.JobSummary{
		Passed:  h.passed,
		Failed:  h.failed,
		Skipped: h.skipped,
		Total:   h.passed + h.failed + h.skipped,
	}
}
