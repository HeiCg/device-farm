package cmd

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/device-farm/cli/internal/config"
	"github.com/device-farm/cli/internal/session"
)

var sessionLeaseCmd = &cobra.Command{
	Use:   "lease",
	Short: "Lease a device for an interactive session",
	Long: `Lease a device for an interactive session.

POSTs to /api/sessions and persists the response (sessionId, wsUrl, token,
deviceId, leaseUntil, platform) to ~/.device-farm/session.json. Subsequent
session subcommands read from the persist file.

Examples:
  device-farm session lease --platform android --ttl 600
  device-farm session lease --platform ios --device-id ABC123`,
	Args: cobra.NoArgs,
	RunE: runSessionLease,
}

func init() {
	sessionLeaseCmd.Flags().String("platform", "android", "device platform (android | ios)")
	sessionLeaseCmd.Flags().Int("ttl", 0, "lease TTL in seconds (server default applies if zero)")
	sessionLeaseCmd.Flags().String("device-id", "", "specific device id to lease (optional)")
	sessionLeaseCmd.Flags().String("device-name", "", "specific device name to lease (optional)")
}

func runSessionLease(cmd *cobra.Command, _ []string) error {
	serverURL := config.ResolveServerURL(ServerFlag)
	apiKey := config.ResolveAPIKey(APIKeyFlag)
	if apiKey == "" {
		return fmt.Errorf("unauthorized: no API key — set --api-key or DEVICE_FARM_API_KEY")
	}

	platform, _ := cmd.Flags().GetString("platform")
	ttl, _ := cmd.Flags().GetInt("ttl")
	deviceID, _ := cmd.Flags().GetString("device-id")
	deviceName, _ := cmd.Flags().GetString("device-name")

	req := session.LeaseRequest{
		Platform:   platform,
		TTLSeconds: ttl,
	}
	if deviceID != "" || deviceName != "" {
		req.DeviceQuery = map[string]any{}
		if deviceID != "" {
			req.DeviceQuery["id"] = deviceID
		}
		if deviceName != "" {
			req.DeviceQuery["name"] = deviceName
		}
	}

	ref, err := session.Lease(serverURL, apiKey, req)
	if err != nil {
		return err
	}
	if err := session.Save(ref); err != nil {
		return fmt.Errorf("persist session: %w", err)
	}

	out := cmd.OutOrStdout()
	fmt.Fprintf(out, "Leased session %s on %s (%s)\n", ref.SessionID, ref.DeviceName, ref.Platform)
	fmt.Fprintf(out, "  wsUrl: %s\n", ref.WSUrl)
	fmt.Fprintf(out, "  leaseUntil: %s\n", ref.LeaseUntil.Format("15:04:05"))
	return nil
}
