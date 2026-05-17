package cmd

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/device-farm/cli/internal/session"
)

var sessionSwipeCmd = &cobra.Command{
	Use:   "swipe",
	Short: "Swipe from (x1,y1) to (x2,y2) on the leased device",
	Long: `Dispatch a swipe envelope over the session WebSocket.

Examples:
  device-farm session swipe --x1 100 --y1 1000 --x2 100 --y2 200 --duration 300`,
	Args: cobra.NoArgs,
	RunE: runSessionSwipe,
}

func init() {
	sessionSwipeCmd.Flags().Int("x1", 0, "start x coordinate")
	sessionSwipeCmd.Flags().Int("y1", 0, "start y coordinate")
	sessionSwipeCmd.Flags().Int("x2", 0, "end x coordinate")
	sessionSwipeCmd.Flags().Int("y2", 0, "end y coordinate")
	sessionSwipeCmd.Flags().Int("duration", 300, "swipe duration in milliseconds")
	for _, f := range []string{"x1", "y1", "x2", "y2"} {
		_ = sessionSwipeCmd.MarkFlagRequired(f)
	}
}

func runSessionSwipe(cmd *cobra.Command, _ []string) error {
	ref, err := resolveSession(cmd)
	if err != nil {
		return err
	}
	x1, _ := cmd.Flags().GetInt("x1")
	y1, _ := cmd.Flags().GetInt("y1")
	x2, _ := cmd.Flags().GetInt("x2")
	y2, _ := cmd.Flags().GetInt("y2")
	durationMs, _ := cmd.Flags().GetInt("duration")

	envelope := map[string]any{
		"type":       "swipe",
		"x1":         x1,
		"y1":         y1,
		"x2":         x2,
		"y2":         y2,
		"durationMs": durationMs,
	}
	result, err := session.SendAction(ref.WSUrl, ref.Token, envelope)
	if err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "swipe ack: forMsgId=%s\n", result["forMsgId"])
	return nil
}
