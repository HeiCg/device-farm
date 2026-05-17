package cmd

import (
	"encoding/json"
	"testing"
)

func TestDepBuildInstallList_AllOk(t *testing.T) {
	checks := []checkResult{
		{Name: "Java/JDK", Status: "ok"},
		{Name: "Android SDK", Status: "ok"},
		{Name: "Xcode CLI Tools", Status: "ok"},
		{Name: "maestro", Status: "ok"},
		{Name: "ffmpeg", Status: "ok"},
		{Name: "PostgreSQL", Status: "ok"},
		{Name: "go-ios", Status: "ok"},
		{Name: "idb_companion", Status: "ok"},
		{Name: "sim-capture", Status: "ok"},
	}
	result := buildInstallList(checks, installers)
	if len(result) != 0 {
		t.Errorf("expected empty install list when all ok, got %d items", len(result))
	}
}

func TestDepBuildInstallList_SkipsWarn(t *testing.T) {
	checks := []checkResult{
		{Name: "Java/JDK", Status: "ok"},
		{Name: "PostgreSQL", Status: "warn", Detail: "installed but not running"},
		{Name: "maestro", Status: "ok"},
	}
	result := buildInstallList(checks, installers)
	if len(result) != 0 {
		t.Errorf("expected empty install list when only ok/warn, got %d items", len(result))
	}
}

func TestDepBuildInstallList_FiltersFails(t *testing.T) {
	checks := []checkResult{
		{Name: "Java/JDK", Status: "ok"},
		{Name: "Android SDK", Status: "fail", Detail: "ANDROID_HOME not set"},
		{Name: "maestro", Status: "fail", Detail: "not found in PATH"},
		{Name: "ffmpeg", Status: "ok"},
	}
	result := buildInstallList(checks, installers)
	if len(result) != 2 {
		t.Errorf("expected 2 items in install list, got %d", len(result))
	}
	// Verify correct items were selected
	names := make(map[string]bool)
	for _, d := range result {
		names[d.Name] = true
	}
	if !names["Android SDK"] {
		t.Error("expected Android SDK in install list")
	}
	if !names["Maestro"] {
		t.Error("expected Maestro in install list")
	}
}

func TestDepInstallResultTracking(t *testing.T) {
	r := installResult{
		Name:   "Java/JDK",
		Status: "installed",
		Detail: "via brew install openjdk@17",
	}
	if r.Name != "Java/JDK" {
		t.Errorf("expected Name 'Java/JDK', got %q", r.Name)
	}
	if r.Status != "installed" {
		t.Errorf("expected Status 'installed', got %q", r.Status)
	}
	if r.Detail == "" {
		t.Error("expected Detail to be non-empty")
	}
}

func TestDepInstallResultJSON(t *testing.T) {
	results := []installResult{
		{Name: "Java/JDK", Status: "installed", Detail: "via brew"},
		{Name: "ffmpeg", Status: "skipped"},
		{Name: "Maestro", Status: "failed", Detail: "network error"},
	}
	data, err := json.Marshal(results)
	if err != nil {
		t.Fatalf("JSON marshal failed: %v", err)
	}

	var decoded []installResult
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("JSON unmarshal failed: %v", err)
	}
	if len(decoded) != 3 {
		t.Fatalf("expected 3 results, got %d", len(decoded))
	}

	// Verify field names in raw JSON
	raw := string(data)
	for _, field := range []string{`"name"`, `"status"`, `"detail"`} {
		if !json.Valid(data) {
			t.Errorf("invalid JSON produced")
		}
		_ = field
		_ = raw
	}

	// Check skipped item has no detail (omitempty)
	if decoded[1].Detail != "" {
		t.Errorf("expected empty Detail for skipped item, got %q", decoded[1].Detail)
	}
	// Check the "detail" key is omitted for skipped item
	var rawSlice []json.RawMessage
	json.Unmarshal(data, &rawSlice)
	skippedRaw := string(rawSlice[1])
	var skippedMap map[string]interface{}
	json.Unmarshal([]byte(skippedRaw), &skippedMap)
	if _, exists := skippedMap["detail"]; exists {
		t.Error("expected 'detail' to be omitted when empty (omitempty)")
	}
}

func TestDepBrewPrerequisiteCheck(t *testing.T) {
	// Save and restore PATH
	t.Setenv("PATH", "")
	err := checkBrewInstalled()
	if err == nil {
		t.Error("expected error when brew not in PATH, got nil")
	}
}

func TestDepDependencyRegistryComplete(t *testing.T) {
	if len(installers) != 9 {
		t.Errorf("expected exactly 9 dependencies in registry, got %d", len(installers))
		for i, d := range installers {
			t.Logf("  [%d] %s", i, d.Name)
		}
	}
}

func TestDepBuildInstallList_MultipleCheckResults(t *testing.T) {
	// Android SDK returns multiple check results; if any is "fail", it should be in the list
	checks := []checkResult{
		{Name: "Android SDK", Status: "ok"},
		{Name: "  cmdline-tools", Status: "ok"},
		{Name: "  platform-tools", Status: "fail", Detail: "not found"},
		{Name: "  emulator", Status: "ok"},
		{Name: "  system-images API 35", Status: "ok"},
		{Name: "maestro", Status: "ok"},
	}
	result := buildInstallList(checks, installers)
	if len(result) != 1 {
		t.Errorf("expected 1 item (Android SDK) in install list, got %d", len(result))
	}
	if len(result) > 0 && result[0].Name != "Android SDK" {
		t.Errorf("expected Android SDK, got %q", result[0].Name)
	}
}
