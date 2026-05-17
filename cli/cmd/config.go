package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"

	"github.com/device-farm/cli/internal/config"
	"github.com/spf13/cobra"
)

var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Manage CLI configuration",
	Long:  "Get, set, and list configuration values stored in ~/.device-farm.yaml.",
}

var configSetCmd = &cobra.Command{
	Use:   "set <key> <value>",
	Short: "Set a configuration value",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		key, value := args[0], args[1]

		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}

		if err := cfg.Set(key, value); err != nil {
			return err
		}

		if err := cfg.Save(); err != nil {
			return fmt.Errorf("saving config: %w", err)
		}

		if JSONOutput {
			return json.NewEncoder(os.Stdout).Encode(map[string]string{
				"key":   key,
				"value": value,
			})
		}

		fmt.Printf("Set %s = %s\n", key, value)
		return nil
	},
}

var configGetCmd = &cobra.Command{
	Use:   "get <key>",
	Short: "Get a configuration value",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		key := args[0]

		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}

		value, err := cfg.Get(key)
		if err != nil {
			return err
		}

		if JSONOutput {
			return json.NewEncoder(os.Stdout).Encode(map[string]string{
				"key":   key,
				"value": value,
			})
		}

		fmt.Println(value)
		return nil
	},
}

var configListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all configuration values",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}

		values := cfg.ListAll()

		if JSONOutput {
			return json.NewEncoder(os.Stdout).Encode(values)
		}

		// Sort keys for consistent output
		keys := make([]string, 0, len(values))
		for k := range values {
			keys = append(keys, k)
		}
		sort.Strings(keys)

		for _, k := range keys {
			v := values[k]
			if v == "" {
				v = "(not set)"
			}
			fmt.Printf("%s = %s\n", k, v)
		}
		return nil
	},
}

func init() {
	configCmd.AddCommand(configSetCmd)
	configCmd.AddCommand(configGetCmd)
	configCmd.AddCommand(configListCmd)
	rootCmd.AddCommand(configCmd)
}
