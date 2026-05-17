package cmd

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/device-farm/cli/internal/client"
)

func TestLogsFetch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/jobs/job-log/logs" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"logs": "line1\nline2\n"}`))
	}))
	defer srv.Close()

	os.Setenv("DEVICE_FARM_URL", srv.URL)
	defer os.Unsetenv("DEVICE_FARM_URL")

	c := client.NewClient(srv.URL, "")
	var buf bytes.Buffer
	err := fetchLogs(context.Background(), c, "job-log", &buf)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "line1\nline2\n"
	if buf.String() != expected {
		t.Errorf("expected %q, got %q", expected, buf.String())
	}
}

func TestLogsFetchJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"logs": "text"}`))
	}))
	defer srv.Close()

	oldJSON := JSONOutput
	defer func() { JSONOutput = oldJSON }()
	JSONOutput = true

	c := client.NewClient(srv.URL, "")
	var buf bytes.Buffer
	err := fetchLogs(context.Background(), c, "job-json", &buf)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if buf.String() != "{\"logs\":\"text\"}\n" {
		t.Errorf("expected JSON output, got %q", buf.String())
	}
}

func TestLogsFetchServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`Internal Server Error`))
	}))
	defer srv.Close()

	c := client.NewClient(srv.URL, "")
	var buf bytes.Buffer
	err := fetchLogs(context.Background(), c, "job-err", &buf)
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
