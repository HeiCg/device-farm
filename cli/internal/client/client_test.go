package client

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthHeader(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "test-api-key")
	_, err := c.Do(context.Background(), "GET", "/api/health", nil, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotAuth != "Bearer test-api-key" {
		t.Errorf("Authorization header: got %q, want %q", gotAuth, "Bearer test-api-key")
	}
}

func TestNoAuthHeader(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "")
	_, err := c.Do(context.Background(), "GET", "/api/health", nil, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotAuth != "" {
		t.Errorf("expected no Authorization header, got: %q", gotAuth)
	}
}

func TestRFC7807Error(t *testing.T) {
	problem := ProblemDetail{
		Type:   "https://device-farm.dev/errors/not-found",
		Title:  "Job Not Found",
		Status: 404,
		Detail: "Job with ID abc-123 does not exist",
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(problem)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "")
	_, err := c.Do(context.Background(), "GET", "/api/jobs/abc-123", nil, "")
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	var pd *ProblemDetail
	if !errors.As(err, &pd) {
		t.Fatalf("expected ProblemDetail error, got: %T", err)
	}
	if pd.Title != "Job Not Found" {
		t.Errorf("title: got %q, want %q", pd.Title, "Job Not Found")
	}
	if pd.Detail != "Job with ID abc-123 does not exist" {
		t.Errorf("detail: got %q, want %q", pd.Detail, "Job with ID abc-123 does not exist")
	}
}

func TestServerUnreachable(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "")
	_, err := c.Do(context.Background(), "GET", "/api/health", nil, "")
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
	var exitErr *ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("expected ExitError, got: %T", err)
	}
	if exitErr.Code != 2 {
		t.Errorf("exit code: got %d, want 2", exitErr.Code)
	}
}
