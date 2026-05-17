package cmd

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/device-farm/cli/internal/client"
	"github.com/fatih/color"
)

func init() {
	// Disable color in tests for predictable output
	color.NoColor = true
}

func TestStatusDisplaysJobDetails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/jobs/job-123" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"id": "job-123",
			"status": "passed",
			"platform": "android",
			"createdAt": "2026-01-01T00:00:00Z",
			"startedAt": "2026-01-01T00:00:05Z",
			"finishedAt": "2026-01-01T00:01:00Z",
			"metadata": {},
			"steps": []
		}`))
	}))
	defer srv.Close()

	out, err := writeStatus(srv.URL, "job-123", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(out, "job-123") {
		t.Errorf("output should contain job ID, got: %s", out)
	}
	if !strings.Contains(out, "passed") {
		t.Errorf("output should contain status, got: %s", out)
	}
	if !strings.Contains(out, "android") {
		t.Errorf("output should contain platform, got: %s", out)
	}
	if !strings.Contains(out, "Completed:") {
		t.Errorf("output should contain Completed: line, got: %s", out)
	}
}

func TestStatusWithSteps(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"id": "job-456",
			"status": "passed",
			"platform": "ios",
			"createdAt": "2026-01-01T00:00:00Z",
			"metadata": {},
			"resultSummary": {"passed": 2, "failed": 0, "skipped": 1, "total": 3},
			"steps": [
				{"flowName": "login", "command": "maestro test login.yaml", "status": "passed", "durationMs": 5000, "stepIndex": 0},
				{"flowName": "checkout", "status": "passed", "durationMs": 3200, "stepIndex": 1}
			]
		}`))
	}))
	defer srv.Close()

	out, err := writeStatus(srv.URL, "job-456", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(out, "login") {
		t.Errorf("output should contain step flow name, got: %s", out)
	}
	if !strings.Contains(out, "FLOW") {
		t.Errorf("output should contain table header FLOW, got: %s", out)
	}
	if !strings.Contains(out, "2 passed") {
		t.Errorf("output should contain result summary, got: %s", out)
	}
	if !strings.Contains(out, "5.0s") {
		t.Errorf("output should contain formatted duration, got: %s", out)
	}
}

func TestStatusJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"id": "job-789",
			"status": "running",
			"platform": "android",
			"createdAt": "2026-01-01T00:00:00Z",
			"metadata": {},
			"steps": []
		}`))
	}))
	defer srv.Close()

	out, err := writeStatus(srv.URL, "job-789", true, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		t.Fatalf("output is not valid JSON: %v\noutput: %s", err, out)
	}
	if result["id"] != "job-789" {
		t.Errorf("JSON should contain job ID, got: %v", result["id"])
	}
}

func TestStatusServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`Internal Server Error`))
	}))
	defer srv.Close()

	_, err := writeStatus(srv.URL, "job-err", false, false)
	if err == nil {
		t.Fatal("expected error on 500 response")
	}

	var exitErr *client.ExitError
	if errors.As(err, &exitErr) {
		if exitErr.Code != 2 {
			t.Errorf("expected exit code 2, got %d", exitErr.Code)
		}
	}
	// ProblemDetail also acceptable
}

func TestStatusFailedJobExitCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"id": "job-fail",
			"status": "failed",
			"platform": "android",
			"createdAt": "2026-01-01T00:00:00Z",
			"metadata": {},
			"steps": []
		}`))
	}))
	defer srv.Close()

	_, err := writeStatus(srv.URL, "job-fail", false, false)
	if err == nil {
		t.Fatal("expected error for failed job")
	}

	var exitErr *client.ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("expected ExitError, got %T: %v", err, err)
	}
	if exitErr.Code != 1 {
		t.Errorf("expected exit code 1, got %d", exitErr.Code)
	}
}
