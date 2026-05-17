package cmd

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/device-farm/cli/internal/session"
)

var sessionTapCmd = &cobra.Command{
	Use:   "tap",
	Short: "Tap at (x,y) on the leased device",
	Long: `Dispatch a tap envelope over the session WebSocket.

Examples:
  device-farm session tap --x 540 --y 960`,
	Args: cobra.NoArgs,
	RunE: runSessionTap,
}

func init() {
	sessionTapCmd.Flags().Int("x", 0, "x coordinate (pixels)")
	sessionTapCmd.Flags().Int("y", 0, "y coordinate (pixels)")
	_ = sessionTapCmd.MarkFlagRequired("x")
	_ = sessionTapCmd.MarkFlagRequired("y")
}

func runSessionTap(cmd *cobra.Command, _ []string) error {
	ref, err := resolveSession(cmd)
	if err != nil {
		return err
	}
	x, _ := cmd.Flags().GetInt("x")
	y, _ := cmd.Flags().GetInt("y")

	envelope := map[string]any{
		"type": "tap",
		"x":    x,
		"y":    y,
	}
	result, err := session.SendAction(ref.WSUrl, ref.Token, envelope)
	if err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "tap ack: forMsgId=%s\n", result["forMsgId"])
	return nil
}
