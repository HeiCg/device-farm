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

var devicesCmd = &cobra.Command{
	Use:   "devices",
	Short: "List all devices in the pool",
	Long:  "Display a table of all registered devices with their platform, status, and current job assignment.",
	Args:  cobra.NoArgs,
	RunE:  runDevices,
}

func init() {
	rootCmd.AddCommand(devicesCmd)
}

func runDevices(cmd *cobra.Command, args []string) error {
	serverURL := config.ResolveServerURL(ServerFlag)
	apiKey := config.ResolveAPIKey(APIKeyFlag)
	c := client.NewClient(serverURL, apiKey)

	devices, err := c.ListDevices(cmd.Context())
	if err != nil {
		return err
	}

	if JSONOutput {
		return output.PrintJSON(cmd.OutOrStdout(), devices)
	}

	w := cmd.OutOrStdout()

	if len(devices) == 0 {
		fmt.Fprintln(w, "No devices found")
		return nil
	}

	headers := []string{"Name", "Platform", "Status", "Current Job"}
	var rows [][]string
	for _, d := range devices {
		sym := output.StatusSymbol(d.State, IsTTY)
		col := output.StatusColor(d.State)
		statusStr := sym + " " + col.Sprint(d.State)
		jobStr := "-"
		if d.CurrentJobID != nil {
			jobStr = *d.CurrentJobID
		}
		rows = append(rows, []string{d.Name, d.Platform, statusStr, jobStr})
	}
	output.PrintTable(w, headers, rows)
	return nil
}

// writeDevices is used by tests to run the command with controlled settings.
func writeDevices(serverURL string, jsonMode bool, isTTY bool) (string, error) {
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
	devicesCmd.SetOut(buf)
	devicesCmd.SetContext(context.Background())
	devicesCmd.SetArgs([]string{})
	err := devicesCmd.RunE(devicesCmd, []string{})
	return buf.String(), err
}
