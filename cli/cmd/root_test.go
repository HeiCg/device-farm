package cmd

import (
	"bytes"
	"testing"
)

func TestRootCommandExists(t *testing.T) {
	if rootCmd == nil {
		t.Fatal("rootCmd is nil")
	}
	if rootCmd.Use != "device-farm" {
		t.Errorf("root command Use: got %q, want %q", rootCmd.Use, "device-farm")
	}
}

func TestGlobalFlags(t *testing.T) {
	flags := []string{"server", "api-key", "json", "no-color"}
	for _, name := range flags {
		f := rootCmd.PersistentFlags().Lookup(name)
		if f == nil {
			t.Errorf("flag --%s not registered", name)
		}
	}
}

func TestExecuteHelp(t *testing.T) {
	buf := new(bytes.Buffer)
	rootCmd.SetOut(buf)
	rootCmd.SetArgs([]string{"--help"})
	err := rootCmd.Execute()
	if err != nil {
		t.Fatalf("execute with --help failed: %v", err)
	}
	if buf.Len() == 0 {
		t.Error("expected help output, got empty")
	}
}
