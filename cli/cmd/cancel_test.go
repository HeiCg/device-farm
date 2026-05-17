package cmd

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/device-farm/cli/internal/client"
)

func TestCancelSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "DELETE" {
			t.Fatalf("expected DELETE, got %s", r.Method)
		}
		if r.URL.Path != "/api/jobs/job-cancel-1" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status": "cancelled"}`))
	}))
	defer srv.Close()

	out, err := writeCancel(srv.URL, "job-cancel-1", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(out, "job-cancel-1") {
		t.Errorf("output should contain job ID, got: %s", out)
	}
	if !strings.Contains(out, "cancelled") {
		t.Errorf("output should contain 'cancelled', got: %s", out)
	}
}

func TestCancelJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status": "cancelled"}`))
	}))
	defer srv.Close()

	out, err := writeCancel(srv.URL, "job-cancel-2", true, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var result map[string]string
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		t.Fatalf("output is not valid JSON: %v\noutput: %s", err, out)
	}
	if result["status"] != "cancelled" {
		t.Errorf("expected status cancelled, got %s", result["status"])
	}
	if result["jobId"] != "job-cancel-2" {
		t.Errorf("expected jobId job-cancel-2, got %s", result["jobId"])
	}
}

func TestCancelNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(404)
		w.Write([]byte(`{"type": "not-found", "title": "Job not found", "status": 404, "detail": "No job with id job-missing"}`))
	}))
	defer srv.Close()

	_, err := writeCancel(srv.URL, "job-missing", false, false)
	if err == nil {
		t.Fatal("expected error on 404 response")
	}

	if !strings.Contains(err.Error(), "not found") && !strings.Contains(err.Error(), "Not found") && !strings.Contains(err.Error(), "Job not found") {
		t.Errorf("error should mention not found, got: %v", err)
	}
}

func TestCancelServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`Internal Server Error`))
	}))
	defer srv.Close()

	_, err := writeCancel(srv.URL, "job-err", false, false)
	if err == nil {
		t.Fatal("expected error on 500 response")
	}

	var exitErr *client.ExitError
	if errors.As(err, &exitErr) {
		if exitErr.Code != 2 {
			t.Errorf("expected exit code 2, got %d", exitErr.Code)
		}
	}
}
