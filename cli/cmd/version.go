package cmd

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// Version is set at build time via -ldflags.
var Version = "dev"

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print the CLI version",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		if JSONOutput {
			return json.NewEncoder(os.Stdout).Encode(map[string]string{
				"version": Version,
			})
		}
		fmt.Printf("device-farm version %s\n", Version)
		return nil
	},
}

func init() {
	rootCmd.AddCommand(versionCmd)
}
