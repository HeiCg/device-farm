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

var cancelCmd = &cobra.Command{
	Use:   "cancel <job-id>",
	Short: "Cancel a running job",
	Long:  "Cancel a running or queued job by sending a DELETE request to the server.",
	Args:  cobra.ExactArgs(1),
	RunE:  runCancel,
}

func init() {
	rootCmd.AddCommand(cancelCmd)
}

func runCancel(cmd *cobra.Command, args []string) error {
	jobID := args[0]

	serverURL := config.ResolveServerURL(ServerFlag)
	apiKey := config.ResolveAPIKey(APIKeyFlag)
	c := client.NewClient(serverURL, apiKey)

	if err := c.CancelJob(cmd.Context(), jobID); err != nil {
		return err
	}

	w := cmd.OutOrStdout()

	if JSONOutput {
		return output.PrintJSON(w, map[string]string{
			"status": "cancelled",
			"jobId":  jobID,
		})
	}

	sym := output.StatusSymbol("cancelled", IsTTY)
	fmt.Fprintf(w, "%s Job %s cancelled\n", sym, jobID)
	return nil
}

// writeCancel is used by tests to run the command with controlled settings.
func writeCancel(serverURL string, jobID string, jsonMode bool, isTTY bool) (string, error) {
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

	buf := &strings.Builder{}
	cancelCmd.SetOut(buf)
	cancelCmd.SetContext(context.Background())
	cancelCmd.SetArgs([]string{jobID})
	err := cancelCmd.RunE(cancelCmd, []string{jobID})
	return buf.String(), err
}
