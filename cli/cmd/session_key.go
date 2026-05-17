package cmd

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/device-farm/cli/internal/session"
)

// Allowed key codes per server/sessions/internal/protocol.ts (Plan 34-02
// KEY_CODES). Kept as a local constant to avoid pulling the generated types
// surface into the CLI; the server is the source of truth and will reject
// unknown codes with `invalid_envelope`.
var allowedKeys = []string{"home", "back", "enter", "menu", "recent", "power", "volume_up", "volume_down"}

var sessionKeyCmd = &cobra.Command{
	Use:   "key",
	Short: "Press a hardware key (home, back, enter, ...) on the leased device",
	Long: `Dispatch a key envelope over the session WebSocket.

Allowed key codes: home, back, enter, menu, recent, power, volume_up, volume_down.

Examples:
  device-farm session key --code home
  device-farm session key --code volume_up`,
	Args: cobra.NoArgs,
	RunE: runSessionKey,
}

func init() {
	sessionKeyCmd.Flags().String("code", "", "key code (one of: home, back, enter, menu, recent, power, volume_up, volume_down)")
	_ = sessionKeyCmd.MarkFlagRequired("code")
}

func runSessionKey(cmd *cobra.Command, _ []string) error {
	ref, err := resolveSession(cmd)
	if err != nil {
		return err
	}
	code, _ := cmd.Flags().GetString("code")

	ok := false
	for _, k := range allowedKeys {
		if k == code {
			ok = true
			break
		}
	}
	if !ok {
		return fmt.Errorf("invalid --code %q (must be one of %v)", code, allowedKeys)
	}

	envelope := map[string]any{
		"type": "key",
		"code": code,
	}
	result, err := session.SendAction(ref.WSUrl, ref.Token, envelope)
	if err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "key ack: forMsgId=%s\n", result["forMsgId"])
	return nil
}
