package main

import (
	"errors"
	"fmt"
	"os"

	"github.com/device-farm/cli/cmd"
	"github.com/device-farm/cli/internal/client"
)

func main() {
	if err := cmd.Execute(); err != nil {
		var exitErr *client.ExitError
		if errors.As(err, &exitErr) {
			os.Exit(exitErr.Code)
		}
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(2)
	}
}
