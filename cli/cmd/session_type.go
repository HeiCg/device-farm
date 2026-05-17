package cmd

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/device-farm/cli/internal/session"
)

var sessionTypeCmd = &cobra.Command{
	Use:   "type",
	Short: "Type text into the focused field on the leased device",
	Long: `Dispatch a type envelope over the session WebSocket.

Examples:
  device-farm session type --text "hello world"`,
	Args: cobra.NoArgs,
	RunE: runSessionType,
}

func init() {
	sessionTypeCmd.Flags().String("text", "", "text to type")
	_ = sessionTypeCmd.MarkFlagRequired("text")
}

func runSessionType(cmd *cobra.Command, _ []string) error {
	ref, err := resolveSession(cmd)
	if err != nil {
		return err
	}
	text, _ := cmd.Flags().GetString("text")

	envelope := map[string]any{
		"type": "type",
		"text": text,
	}
	result, err := session.SendAction(ref.WSUrl, ref.Token, envelope)
	if err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "type ack: forMsgId=%s\n", result["forMsgId"])
	return nil
}
