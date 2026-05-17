package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"
)

// Pipeline represents a pipeline definition.
type Pipeline struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	YAMLContent string `json:"yamlContent"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// PipelineRun represents a pipeline execution.
type PipelineRun struct {
	ID           string          `json:"id"`
	PipelineID   string          `json:"pipelineId"`
	TriggerType  string          `json:"triggerType"`
	Status       string          `json:"status"`
	Variables    json.RawMessage `json:"variables"`
	StartedAt    *string         `json:"startedAt"`
	FinishedAt   *string         `json:"finishedAt"`
	SourceBranch *string         `json:"sourceBranch"`
	SourceCommit *string         `json:"sourceCommit"`
	ErrorMessage *string         `json:"errorMessage"`
	Stages       []StageRun      `json:"stages,omitempty"`
}

// StageRun represents a stage within a pipeline run.
type StageRun struct {
	ID           string  `json:"id"`
	StageName    string  `json:"stageName"`
	StageIndex   int     `json:"stageIndex"`
	Type         string  `json:"type"`
	Status       string  `json:"status"`
	StartedAt    *string `json:"startedAt"`
	FinishedAt   *string `json:"finishedAt"`
	Logs         *string `json:"logs"`
	ErrorMessage *string `json:"errorMessage"`
}

// TriggerRunResponse is returned when triggering a pipeline run.
type TriggerRunResponse struct {
	RunID  string `json:"run_id"`
	Status string `json:"status"`
	URL    string `json:"url"`
}

// ListPipelines returns all pipelines.
func (c *Client) ListPipelines(ctx context.Context) ([]Pipeline, error) {
	resp, err := c.Do(ctx, "GET", "/api/pipelines", nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var pipelines []Pipeline
	if err := json.NewDecoder(resp.Body).Decode(&pipelines); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}
	return pipelines, nil
}

// GetPipeline returns a pipeline by ID or name.
func (c *Client) GetPipeline(ctx context.Context, idOrName string) (*Pipeline, error) {
	resp, err := c.Do(ctx, "GET", "/api/pipelines/"+idOrName, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var p Pipeline
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}
	return &p, nil
}

// CreatePipeline creates a new pipeline from YAML content.
func (c *Client) CreatePipeline(ctx context.Context, yamlContent string) (*Pipeline, error) {
	resp, err := c.Do(ctx, "POST", "/api/pipelines", bytes.NewBufferString(yamlContent), "text/plain")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var p Pipeline
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}
	return &p, nil
}

// UpdatePipeline updates a pipeline's YAML content.
func (c *Client) UpdatePipeline(ctx context.Context, id string, yamlContent string) error {
	resp, err := c.Do(ctx, "PUT", "/api/pipelines/"+id, bytes.NewBufferString(yamlContent), "text/plain")
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// TriggerRun triggers a pipeline run with variables.
func (c *Client) TriggerRun(ctx context.Context, idOrName string, variables map[string]string) (*TriggerRunResponse, error) {
	body := map[string]interface{}{
		"variables": variables,
	}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("encoding body: %w", err)
	}

	resp, err := c.Do(ctx, "POST", "/api/pipelines/"+idOrName+"/run", bytes.NewBuffer(jsonBody), "application/json")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result TriggerRunResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}
	return &result, nil
}

// GetPipelineRun returns a run with its stages.
func (c *Client) GetPipelineRun(ctx context.Context, runID string) (*PipelineRun, error) {
	resp, err := c.Do(ctx, "GET", "/api/pipeline-runs/"+runID, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var run PipelineRun
	if err := json.NewDecoder(resp.Body).Decode(&run); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}
	return &run, nil
}

// ListPipelineRuns returns runs for a pipeline.
func (c *Client) ListPipelineRuns(ctx context.Context, pipelineID string) ([]PipelineRun, error) {
	path := "/api/pipeline-runs"
	if pipelineID != "" {
		path += "?pipeline_id=" + pipelineID
	}

	resp, err := c.Do(ctx, "GET", path, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var runs []PipelineRun
	if err := json.NewDecoder(resp.Body).Decode(&runs); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}
	return runs, nil
}

// StreamPipelineRunLogs polls the run status and writes stage logs to the writer
// until the run completes or the context is cancelled.
func (c *Client) StreamPipelineRunLogs(ctx context.Context, runID string, w io.Writer) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		run, err := c.GetPipelineRun(ctx, runID)
		if err != nil {
			return err
		}

		// Print stages
		for _, stage := range run.Stages {
			if stage.Logs != nil && *stage.Logs != "" {
				fmt.Fprintf(w, "[%s] %s\n", stage.StageName, *stage.Logs)
			}
		}

		// Check if run is complete
		switch run.Status {
		case "passed", "failed", "cancelled":
			fmt.Fprintf(w, "\nPipeline run %s: %s\n", runID, run.Status)
			return nil
		}

		// Poll interval
		timer := time.NewTimer(3 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}
