package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"text/tabwriter"

	"github.com/device-farm/cli/internal/client"
	"github.com/device-farm/cli/internal/config"
	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var pipelinesCmd = &cobra.Command{
	Use:   "pipelines",
	Short: "Manage pipelines",
	Long:  "Create, list, update, and run pipelines on the Device Farm server.",
}

// -- pipelines list --

var pipelinesListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all pipelines",
	RunE:  runPipelinesList,
}

func runPipelinesList(cmd *cobra.Command, args []string) error {
	c := newPipelinesClient()
	pipelines, err := c.ListPipelines(context.Background())
	if err != nil {
		return err
	}

	if JSONOutput {
		return json.NewEncoder(os.Stdout).Encode(pipelines)
	}

	if len(pipelines) == 0 {
		fmt.Println("No pipelines found.")
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "NAME\tID\tUPDATED")
	for _, p := range pipelines {
		id := p.ID
		if len(id) > 8 {
			id = id[:8]
		}
		updated := p.UpdatedAt
		if len(updated) > 10 {
			updated = updated[:10]
		}
		fmt.Fprintf(w, "%s\t%s\t%s\n", p.Name, id, updated)
	}
	return w.Flush()
}

// -- pipelines create --

var pipelinesCreateCmd = &cobra.Command{
	Use:   "create <file.yaml>",
	Short: "Create a pipeline from YAML file",
	Args:  cobra.ExactArgs(1),
	RunE:  runPipelinesCreate,
}

func runPipelinesCreate(cmd *cobra.Command, args []string) error {
	content, err := os.ReadFile(args[0])
	if err != nil {
		return fmt.Errorf("reading file: %w", err)
	}

	c := newPipelinesClient()
	p, err := c.CreatePipeline(context.Background(), string(content))
	if err != nil {
		return err
	}

	if JSONOutput {
		return json.NewEncoder(os.Stdout).Encode(p)
	}

	id := p.ID
	if len(id) > 8 {
		id = id[:8]
	}
	green := color.New(color.FgGreen).SprintFunc()
	fmt.Printf("%s Pipeline \"%s\" created (ID: %s)\n", green("✓"), p.Name, id)
	return nil
}

// -- pipelines update --

var pipelinesUpdateCmd = &cobra.Command{
	Use:   "update <name-or-id> <file.yaml>",
	Short: "Update a pipeline's YAML",
	Args:  cobra.ExactArgs(2),
	RunE:  runPipelinesUpdate,
}

func runPipelinesUpdate(cmd *cobra.Command, args []string) error {
	content, err := os.ReadFile(args[1])
	if err != nil {
		return fmt.Errorf("reading file: %w", err)
	}

	c := newPipelinesClient()
	p, err := c.GetPipeline(context.Background(), args[0])
	if err != nil {
		return err
	}

	if err := c.UpdatePipeline(context.Background(), p.ID, string(content)); err != nil {
		return err
	}

	if !JSONOutput {
		green := color.New(color.FgGreen).SprintFunc()
		fmt.Printf("%s Pipeline \"%s\" updated\n", green("✓"), p.Name)
	}
	return nil
}

// -- pipelines validate --

var pipelinesValidateCmd = &cobra.Command{
	Use:   "validate <file.yaml>",
	Short: "Validate pipeline YAML without creating",
	Args:  cobra.ExactArgs(1),
	RunE:  runPipelinesValidate,
}

func runPipelinesValidate(cmd *cobra.Command, args []string) error {
	content, err := os.ReadFile(args[0])
	if err != nil {
		return fmt.Errorf("reading file: %w", err)
	}

	s := strings.TrimSpace(string(content))
	if s == "" {
		return fmt.Errorf("empty file")
	}

	var errors []string
	if !strings.Contains(s, "name:") {
		errors = append(errors, "missing required field: name")
	}
	if !strings.Contains(s, "stages:") {
		errors = append(errors, "missing required field: stages")
	}

	if len(errors) > 0 {
		red := color.New(color.FgRed).SprintFunc()
		for _, e := range errors {
			fmt.Printf("  %s %s\n", red("✗"), e)
		}
		return &client.ExitError{Code: 1, Message: "validation failed"}
	}

	green := color.New(color.FgGreen).SprintFunc()
	fmt.Printf("%s Pipeline YAML looks valid (basic check). Use 'pipelines create' for full server validation.\n", green("✓"))
	return nil
}

// -- pipelines run --

var pipelinesRunVars []string

var pipelinesRunCmd = &cobra.Command{
	Use:   "run <name-or-id>",
	Short: "Trigger a pipeline run",
	Args:  cobra.ExactArgs(1),
	RunE:  runPipelinesRun,
}

func runPipelinesRun(cmd *cobra.Command, args []string) error {
	vars := make(map[string]string)
	for _, v := range pipelinesRunVars {
		key, value, ok := strings.Cut(v, "=")
		if !ok {
			return fmt.Errorf("invalid --var format: %q (expected key=value)", v)
		}
		vars[key] = value
	}

	c := newPipelinesClient()
	result, err := c.TriggerRun(context.Background(), args[0], vars)
	if err != nil {
		return err
	}

	if JSONOutput {
		return json.NewEncoder(os.Stdout).Encode(result)
	}

	green := color.New(color.FgGreen).SprintFunc()
	fmt.Printf("%s Pipeline run created: %s\n", green("✓"), result.RunID)
	fmt.Printf("  Status: %s\n", result.Status)
	if result.URL != "" {
		fmt.Printf("  View:   %s%s\n", config.ResolveServerURL(ServerFlag), result.URL)
	}
	return nil
}

// -- pipelines runs --

var pipelinesRunsCmd = &cobra.Command{
	Use:   "runs [name-or-id]",
	Short: "List pipeline runs",
	Args:  cobra.MaximumNArgs(1),
	RunE:  runPipelinesRuns,
}

func runPipelinesRuns(cmd *cobra.Command, args []string) error {
	c := newPipelinesClient()

	pipelineID := ""
	if len(args) > 0 {
		p, err := c.GetPipeline(context.Background(), args[0])
		if err != nil {
			return err
		}
		pipelineID = p.ID
	}

	runs, err := c.ListPipelineRuns(context.Background(), pipelineID)
	if err != nil {
		return err
	}

	if JSONOutput {
		return json.NewEncoder(os.Stdout).Encode(runs)
	}

	if len(runs) == 0 {
		fmt.Println("No runs found.")
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "RUN ID\tSTATUS\tTRIGGER\tSTARTED")
	for _, r := range runs {
		id := r.ID
		if len(id) > 8 {
			id = id[:8]
		}
		started := "-"
		if r.StartedAt != nil && len(*r.StartedAt) >= 19 {
			started = (*r.StartedAt)[:19]
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", id, colorizeStatus(r.Status), r.TriggerType, started)
	}
	return w.Flush()
}

func colorizeStatus(status string) string {
	switch status {
	case "passed":
		return color.New(color.FgGreen).Sprint(status)
	case "failed":
		return color.New(color.FgRed).Sprint(status)
	case "running":
		return color.New(color.FgYellow).Sprint(status)
	case "cancelled":
		return color.New(color.FgMagenta).Sprint(status)
	default:
		return status
	}
}

// -- pipelines logs --

var pipelinesLogsFollow bool

var pipelinesLogsCmd = &cobra.Command{
	Use:   "logs <run-id>",
	Short: "View or stream pipeline run logs",
	Args:  cobra.ExactArgs(1),
	RunE:  runPipelinesLogs,
}

func runPipelinesLogs(cmd *cobra.Command, args []string) error {
	c := newPipelinesClient()

	if pipelinesLogsFollow {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		go func() {
			<-sigCh
			cancel()
		}()

		return c.StreamPipelineRunLogs(ctx, args[0], os.Stdout)
	}

	// Non-follow: get current state
	run, err := c.GetPipelineRun(context.Background(), args[0])
	if err != nil {
		return err
	}

	if JSONOutput {
		return json.NewEncoder(os.Stdout).Encode(run)
	}

	id := run.ID
	if len(id) > 8 {
		id = id[:8]
	}
	bold := color.New(color.Bold).SprintFunc()
	fmt.Printf("%s Run %s (%s)\n\n", bold("Pipeline"), id, colorizeStatus(run.Status))

	for _, stage := range run.Stages {
		fmt.Printf("  %s [%s] %s\n", bold(stage.StageName), stage.Type, colorizeStatus(stage.Status))
		if stage.Logs != nil && *stage.Logs != "" {
			for _, line := range strings.Split(*stage.Logs, "\n") {
				fmt.Printf("    %s\n", line)
			}
		}
		if stage.ErrorMessage != nil && *stage.ErrorMessage != "" {
			red := color.New(color.FgRed).SprintFunc()
			fmt.Printf("    %s %s\n", red("Error:"), *stage.ErrorMessage)
		}
		fmt.Println()
	}

	return nil
}

// newPipelinesClient creates a client using resolved server URL and API key.
func newPipelinesClient() *client.Client {
	return client.NewClient(
		config.ResolveServerURL(ServerFlag),
		config.ResolveAPIKey(APIKeyFlag),
	)
}

func init() {
	pipelinesRunCmd.Flags().StringSliceVar(&pipelinesRunVars, "var", nil, "Variables for the run (key=value, can be repeated)")
	pipelinesLogsCmd.Flags().BoolVar(&pipelinesLogsFollow, "follow", false, "Stream logs until run completes")

	pipelinesCmd.AddCommand(pipelinesListCmd)
	pipelinesCmd.AddCommand(pipelinesCreateCmd)
	pipelinesCmd.AddCommand(pipelinesUpdateCmd)
	pipelinesCmd.AddCommand(pipelinesValidateCmd)
	pipelinesCmd.AddCommand(pipelinesRunCmd)
	pipelinesCmd.AddCommand(pipelinesRunsCmd)
	pipelinesCmd.AddCommand(pipelinesLogsCmd)

	rootCmd.AddCommand(pipelinesCmd)
}
