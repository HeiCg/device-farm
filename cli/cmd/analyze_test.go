// Phase 37 Plan 37-01 — analyze subcommand tests.

package cmd

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeMinimalIPA(t *testing.T, dir string) string {
	t.Helper()
	// Build a synthetic .ipa with Payload/Test.app/Info.plist + empty
	// executable + main.jsbundle (Hermes-magic prefix). Info.plist is
	// shipped as JSON so we don't depend on plutil to convert from
	// binary.
	infoPlist := map[string]interface{}{
		"CFBundleIdentifier":         "com.example.test",
		"CFBundleShortVersionString": "1.2.3",
		"CFBundleExecutable":         "TestApp",
		"CFBundleURLTypes": []map[string]interface{}{
			{
				"CFBundleURLName":    "com.example.url",
				"CFBundleURLSchemes": []string{"exampleapp", "examplehttps"},
			},
		},
	}
	infoBytes, err := json.Marshal(infoPlist)
	if err != nil {
		t.Fatal(err)
	}
	ipaPath := filepath.Join(dir, "test.ipa")
	f, err := os.Create(ipaPath)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	// Info.plist (JSON-shaped — Pitfall 7 fallback path)
	w1, err := zw.Create("Payload/Test.app/Info.plist")
	must(err)
	_, err = w1.Write(infoBytes)
	must(err)
	// Empty executable (we won't call otool on it in tests — analyzeIPA
	// will report failures under known_gaps[]).
	w2, err := zw.Create("Payload/Test.app/TestApp")
	must(err)
	_, err = w2.Write([]byte{0, 0, 0, 0})
	must(err)
	// Synthetic Hermes bundle
	body := append([]byte{}, []byte{0xC6, 0x1F, 0xBC, 0x03, 0xC1, 0x03, 0x19, 0x1F}...)
	body = append(body, []byte("LoginScreen\x00HomeScreen\x00ProfileScreen\x00")...)
	w3, err := zw.Create("Payload/Test.app/main.jsbundle")
	must(err)
	_, err = w3.Write(body)
	must(err)
	must(zw.Close())
	return ipaPath
}

func TestAnalyzeCommandJsonOutput(t *testing.T) {
	tmp := t.TempDir()
	ipa := writeMinimalIPA(t, tmp)

	cmd := newAnalyzeCmd()
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{ipa})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute: %v\n%s", err, out.String())
	}
	var payload SkeletonPayload
	if err := json.Unmarshal(out.Bytes(), &payload); err != nil {
		t.Fatalf("decode payload: %v\nraw: %s", err, out.String())
	}
	if payload.SchemaVersion != 1 {
		t.Errorf("schema_version = %d, want 1", payload.SchemaVersion)
	}
	if payload.Platform != "ios" {
		t.Errorf("platform = %q, want ios", payload.Platform)
	}
	if payload.App.BundleID != "com.example.test" {
		t.Errorf("bundle_id = %q, want com.example.test", payload.App.BundleID)
	}
	if payload.App.Version != "1.2.3" {
		t.Errorf("version = %q, want 1.2.3", payload.App.Version)
	}
	if payload.ReactNativeBundle == nil || !payload.ReactNativeBundle.Hermes {
		t.Errorf("expected Hermes detection, got %+v", payload.ReactNativeBundle)
	}
	// At least the 3 Hermes screens should be present.
	gotNames := map[string]bool{}
	for _, s := range payload.CandidateScreens {
		gotNames[s.Name] = true
	}
	for _, want := range []string{"LoginScreen", "HomeScreen", "ProfileScreen"} {
		if !gotNames[want] {
			t.Errorf("expected screen %q in payload, got: %v", want, payload.CandidateScreens)
		}
	}
	// Deep link from Info.plist
	if len(payload.DeepLinkEntries) < 1 {
		t.Errorf("expected at least 1 deep link, got %d", len(payload.DeepLinkEntries))
	}
}

func TestAnalyzeCommandMarkdownOutput(t *testing.T) {
	tmp := t.TempDir()
	ipa := writeMinimalIPA(t, tmp)
	cmd := newAnalyzeCmd()
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{ipa, "--format", "markdown"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute: %v\n%s", err, out.String())
	}
	if !strings.Contains(out.String(), "# Skeleton — com.example.test") {
		t.Errorf("expected markdown title; got:\n%s", out.String())
	}
}

func TestAnalyzeCommandUpload(t *testing.T) {
	tmp := t.TempDir()
	ipa := writeMinimalIPA(t, tmp)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || !strings.HasPrefix(r.URL.Path, "/api/builds/") || !strings.HasSuffix(r.URL.Path, "/skeleton") {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"analysisId":"00000000-0000-0000-0000-000000000001"}`))
	}))
	defer srv.Close()

	cmd := newAnalyzeCmd()
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{ipa, "--upload-to-build", "buildXYZ", "--analyze-server", srv.URL})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute: %v\n%s", err, out.String())
	}
}
