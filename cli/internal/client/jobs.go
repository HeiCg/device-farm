package client

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
)

// GetJob retrieves a single job by ID.
func (c *Client) GetJob(ctx context.Context, jobID string) (*Job, error) {
	resp, err := c.Do(ctx, "GET", "/api/jobs/"+url.PathEscape(jobID), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var job Job
	if err := json.NewDecoder(resp.Body).Decode(&job); err != nil {
		return nil, &ExitError{Code: 2, Message: fmt.Sprintf("decoding job response: %v", err)}
	}
	return &job, nil
}

// GetJobLogs retrieves the raw logs for a job.
func (c *Client) GetJobLogs(ctx context.Context, jobID string) (string, error) {
	resp, err := c.Do(ctx, "GET", "/api/jobs/"+url.PathEscape(jobID)+"/logs", nil, "")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		Logs string `json:"logs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", &ExitError{Code: 2, Message: fmt.Sprintf("decoding logs response: %v", err)}
	}
	return result.Logs, nil
}

// ListJobs retrieves a paginated list of jobs with optional filters.
func (c *Client) ListJobs(ctx context.Context, params ListJobsParams) (*JobListResponse, error) {
	q := url.Values{}
	if params.Cursor != "" {
		q.Set("cursor", params.Cursor)
	}
	if params.Status != "" {
		q.Set("status", params.Status)
	}
	if params.Platform != "" {
		q.Set("platform", params.Platform)
	}
	if params.Limit > 0 {
		q.Set("limit", strconv.Itoa(params.Limit))
	}

	path := "/api/jobs"
	if encoded := q.Encode(); encoded != "" {
		path += "?" + encoded
	}

	resp, err := c.Do(ctx, "GET", path, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result JobListResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, &ExitError{Code: 2, Message: fmt.Sprintf("decoding jobs list response: %v", err)}
	}
	return &result, nil
}

// CancelJob cancels a job by sending DELETE to the server.
func (c *Client) CancelJob(ctx context.Context, jobID string) error {
	resp, err := c.Do(ctx, "DELETE", "/api/jobs/"+url.PathEscape(jobID), nil, "")
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}
