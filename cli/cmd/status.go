package cmd

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/device-farm/cli/internal/client"
	"github.com/device-farm/cli/internal/config"
	"github.com/device-farm/cli/internal/output"
	"github.com/spf13/cobra"
)

var statusCmd = &cobra.Command{
	Use:   "status <job-id>",
	Short: "Display the status of a job",
	Long:  "Show detailed information about a job including platform, timing, results, and step details.",
	Args:  cobra.ExactArgs(1),
	RunE:  runStatus,
}

func init() {
	rootCmd.AddCommand(statusCmd)
}

func runStatus(cmd *cobra.Command, args []string) error {
	jobID := args[0]

	serverURL := config.ResolveServerURL(ServerFlag)
	apiKey := config.ResolveAPIKey(APIKeyFlag)
	c := client.NewClient(serverURL, apiKey)

	job, err := c.GetJob(cmd.Context(), jobID)
	if err != nil {
		return err
	}

	if JSONOutput {
		return output.PrintJSON(cmd.OutOrStdout(), job)
	}

	w := cmd.OutOrStdout()

	// Header: Job ID with status symbol and colored status
	sym := output.StatusSymbol(job.Status, IsTTY)
	col := output.StatusColor(job.Status)
	fmt.Fprintf(w, "Job %s  %s %s\n", job.ID, sym, col.Sprint(job.Status))
	fmt.Fprintln(w)

	// Fields
	fmt.Fprintf(w, "  Platform:   %s\n", job.Platform)
	fmt.Fprintf(w, "  Created:    %s\n", job.CreatedAt)
	if job.StartedAt != nil {
		fmt.Fprintf(w, "  Started:    %s\n", *job.StartedAt)
	}
	if job.FinishedAt != nil {
		fmt.Fprintf(w, "  Completed:  %s\n", *job.FinishedAt)
	}
	if job.DeviceName != nil {
		fmt.Fprintf(w, "  Device:     %s\n", *job.DeviceName)
	}

	// Result summary
	if job.ResultSummary != nil {
		passed := formatNum(job.ResultSummary["passed"])
		failed := formatNum(job.ResultSummary["failed"])
		skipped := formatNum(job.ResultSummary["skipped"])
		fmt.Fprintln(w)
		fmt.Fprintf(w, "  Results: %s passed, %s failed, %s skipped\n", passed, failed, skipped)
	}

	// Steps table
	if len(job.Steps) > 0 {
		fmt.Fprintln(w)
		headers := []string{"Flow", "Command", "Status", "Duration"}
		var rows [][]string
		for _, step := range job.Steps {
			cmdStr := "-"
			if step.Command != nil {
				cmdStr = *step.Command
			}
			dur := "-"
			if step.DurationMs != nil {
				dur = formatDuration(*step.DurationMs)
			}
			stepSym := output.StatusSymbol(step.Status, IsTTY)
			stepCol := output.StatusColor(step.Status)
			statusStr := stepSym + " " + stepCol.Sprint(step.Status)
			rows = append(rows, []string{step.FlowName, cmdStr, statusStr, dur})
		}
		output.PrintTable(w, headers, rows)
	}

	// Exit code based on job status
	switch job.Status {
	case "failed", "timeout", "error":
		return &client.ExitError{Code: 1, Message: fmt.Sprintf("job %s %s", job.ID, job.Status)}
	}

	return nil
}

func formatNum(v any) string {
	switch n := v.(type) {
	case float64:
		return fmt.Sprintf("%d", int(n))
	case int:
		return fmt.Sprintf("%d", n)
	default:
		return "0"
	}
}

func formatDuration(ms int) string {
	if ms < 1000 {
		return fmt.Sprintf("%dms", ms)
	}
	secs := float64(ms) / 1000.0
	if secs < 60 {
		return fmt.Sprintf("%.1fs", secs)
	}
	mins := int(secs) / 60
	remainSecs := int(secs) % 60
	return fmt.Sprintf("%dm%ds", mins, remainSecs)
}

// writeStatus is used by tests to override globals and run the command.
func writeStatus(serverURL string, jobID string, jsonMode bool, isTTY bool) (string, error) {
	// Save and restore globals
	oldServer := ServerFlag
	oldJSON := JSONOutput
	oldTTY := IsTTY
	defer func() {
		ServerFlag = oldServer
		JSONOutput = oldJSON
		IsTTY = oldTTY
	}()

	ServerFlag = ""
	JSONOutput = jsonMode
	IsTTY = isTTY

	os.Setenv("DEVICE_FARM_URL", serverURL)
	defer os.Unsetenv("DEVICE_FARM_URL")

	cmd := &cobra.Command{Use: "test"}
	cmd.AddCommand(statusCmd)

	buf := &strings.Builder{}
	statusCmd.SetOut(buf)
	statusCmd.SetContext(context.Background())
	statusCmd.SetArgs([]string{jobID})
	err := statusCmd.RunE(statusCmd, []string{jobID})
	return buf.String(), err
}
