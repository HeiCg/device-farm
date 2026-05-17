package client

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ExitError represents an error with a specific exit code.
type ExitError struct {
	Code    int
	Message string
}

func (e *ExitError) Error() string {
	return e.Message
}

// NewExitError creates an ExitError with the given code and message.
func NewExitError(code int, msg string) *ExitError {
	return &ExitError{Code: code, Message: msg}
}

// ProblemDetail represents an RFC 7807 Problem Details response.
type ProblemDetail struct {
	Type     string `json:"type"`
	Title    string `json:"title"`
	Status   int    `json:"status"`
	Detail   string `json:"detail"`
	Instance string `json:"instance"`
}

func (p *ProblemDetail) Error() string {
	if p.Detail != "" {
		return fmt.Sprintf("%s: %s", p.Title, p.Detail)
	}
	return p.Title
}

// Client is an HTTP client for the Device Farm API.
type Client struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
}

// NewClient creates a new API client with a 30s timeout.
func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		BaseURL: baseURL,
		APIKey:  apiKey,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Do executes an HTTP request, adding auth headers and parsing error responses.
func (c *Client) Do(ctx context.Context, method, path string, body io.Reader, contentType string) (*http.Response, error) {
	url := c.BaseURL + path
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, &ExitError{Code: 2, Message: fmt.Sprintf("creating request: %v", err)}
	}

	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, &ExitError{Code: 2, Message: fmt.Sprintf("server unreachable: %v", err)}
	}

	if resp.StatusCode >= 400 {
		defer resp.Body.Close()
		respBody, _ := io.ReadAll(resp.Body)

		var problem ProblemDetail
		if err := json.Unmarshal(respBody, &problem); err == nil && problem.Title != "" {
			return nil, &problem
		}
		return nil, &ExitError{
			Code:    2,
			Message: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody)),
		}
	}

	return resp, nil
}
