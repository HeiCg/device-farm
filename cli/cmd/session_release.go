package cmd

import (
	"errors"
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/device-farm/cli/internal/config"
	"github.com/device-farm/cli/internal/session"
)

var sessionReleaseCmd = &cobra.Command{
	Use:   "release",
	Short: "Release the leased device session",
	Long: `DELETE the leased session on the server and clear the local persist file.

If --session-id is omitted, releases the session referenced by the persist file.

Examples:
  device-farm session release
  device-farm session release --session-id 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d`,
	Args: cobra.NoArgs,
	RunE: runSessionRelease,
}

func runSessionRelease(cmd *cobra.Command, _ []string) error {
	serverURL := config.ResolveServerURL(ServerFlag)
	apiKey := config.ResolveAPIKey(APIKeyFlag)
	if apiKey == "" {
		return fmt.Errorf("unauthorized: no API key — set --api-key or DEVICE_FARM_API_KEY")
	}

	flagID, _ := cmd.Flags().GetString("session-id")
	envID := os.Getenv("DEVICE_FARM_SESSION_ID")

	sessionID := flagID
	if sessionID == "" {
		sessionID = envID
	}
	if sessionID == "" {
		ref, err := session.Load()
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return errors.New("no active session to release — run `device-farm session lease` first")
			}
			return fmt.Errorf("load persisted session: %w", err)
		}
		sessionID = ref.SessionID
	}

	if err := session.Release(serverURL, apiKey, sessionID); err != nil {
		return err
	}
	if err := session.Clear(); err != nil {
		return fmt.Errorf("clear persisted session: %w", err)
	}

	fmt.Fprintf(cmd.OutOrStdout(), "Released session %s\n", sessionID)
	return nil
}
