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

func TestDevicesTable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/devices" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[
			{"name": "pixel-7", "platform": "android", "state": "idle", "emulatorId": "emulator-5554", "currentJobId": null},
			{"name": "iphone-15", "platform": "ios", "state": "running", "emulatorId": "sim-001", "currentJobId": "job-123"}
		]`))
	}))
	defer srv.Close()

	out, err := writeDevices(srv.URL, false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(out, "NAME") {
		t.Errorf("output should contain NAME header, got: %s", out)
	}
	if !strings.Contains(out, "PLATFORM") {
		t.Errorf("output should contain PLATFORM header, got: %s", out)
	}
	if !strings.Contains(out, "pixel-7") {
		t.Errorf("output should contain device name, got: %s", out)
	}
	if !strings.Contains(out, "job-123") {
		t.Errorf("output should contain current job ID, got: %s", out)
	}
}

func TestDevicesJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[
			{"name": "pixel-7", "platform": "android", "state": "idle", "emulatorId": "emulator-5554", "currentJobId": null}
		]`))
	}))
	defer srv.Close()

	out, err := writeDevices(srv.URL, true, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var result []map[string]any
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		t.Fatalf("output is not valid JSON array: %v\noutput: %s", err, out)
	}
	if len(result) != 1 {
		t.Errorf("expected 1 device, got %d", len(result))
	}
	if result[0]["name"] != "pixel-7" {
		t.Errorf("expected device name pixel-7, got %v", result[0]["name"])
	}
}

func TestDevicesEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[]`))
	}))
	defer srv.Close()

	out, err := writeDevices(srv.URL, false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(out, "No devices found") {
		t.Errorf("output should say 'No devices found', got: %s", out)
	}
}

func TestDevicesServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`Internal Server Error`))
	}))
	defer srv.Close()

	_, err := writeDevices(srv.URL, false, false)
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
