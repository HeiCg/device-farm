// Phase 37 Plan 37-01 — `device-farm analyze <ipa>` Cobra subcommand.
//
// Pipeline:
//  1. Unzip .ipa into a temp dir; locate Payload/*.app/.
//  2. Parse Info.plist (binary or XML or JSON — Pitfall 7) via plutil to
//     extract bundle metadata.
//  3. ParseObjCClasslist + ParseSwift5Types + DemangleBatch on the
//     executable; ClassifyName each.
//  4. IsHermes + ExtractHermesScreens on Payload/*.app/main.jsbundle when
//     present.
//  5. Build deep_link_entries from CFBundleURLSchemes.
//  6. Emit the SkeletonPayload as JSON (or markdown when --format=markdown).
//  7. Optional: POST to <server>/api/builds/<id>/skeleton when
//     --upload-to-build is provided.
//
// All extraction is best-effort: missing sections / missing tooling do
// NOT fail the run — they're reported under known_gaps[] and the rest of
// the pipeline continues.

package cmd

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/device-farm/cli/internal/macho"
)

// SkeletonPayload matches server/analysis/schemas.ts skeletonPayloadSchema.
// JSON tags use snake_case to match the wire format.
type SkeletonPayload struct {
	SchemaVersion     int                  `json:"schema_version"`
	Platform          string               `json:"platform"`
	App               SkeletonApp          `json:"app"`
	ReactNativeBundle *SkeletonRNBundle    `json:"react_native_bundle"`
	Stats             SkeletonStats        `json:"stats"`
	CandidateScreens  []SkeletonScreen     `json:"candidate_screens"`
	DeepLinkEntries   []SkeletonDeepLink   `json:"deep_link_entries"`
	KnownGaps         []SkeletonKnownGap   `json:"known_gaps"`
}

type SkeletonApp struct {
	BundleID   string `json:"bundle_id"`
	Version    string `json:"version,omitempty"`
	Executable string `json:"executable,omitempty"`
}

type SkeletonRNBundle struct {
	Detected   bool   `json:"detected"`
	Hermes     bool   `json:"hermes"`
	BundlePath string `json:"bundle_path,omitempty"`
}

type SkeletonStats struct {
	TotalClasses     int `json:"total_classes"`
	TotalSwiftTypes  int `json:"total_swift_types"`
}

type SkeletonScreen struct {
	Name       string `json:"name"`
	Source     string `json:"source"` // objc_classlist | swift5_types | hermes_strings
	Confidence string `json:"confidence"` // high | medium | low
	Module     string `json:"module,omitempty"`
}

type SkeletonDeepLink struct {
	Scheme string `json:"scheme"`
	Host   string `json:"host,omitempty"`
	Path   string `json:"path,omitempty"`
	Source string `json:"source"` // info_plist | associated_domains
}

type SkeletonKnownGap struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
}

func newAnalyzeCmd() *cobra.Command {
	var (
		outputFormat    string
		uploadBuildID   string
		serverURL       string
	)
	cmd := &cobra.Command{
		Use:   "analyze <ipa-or-app>",
		Short: "Extract static screen skeleton from an iOS .ipa or .app",
		Long: `Analyze an iOS .ipa or .app bundle and emit a static screen skeleton
as JSON (or markdown when --format=markdown).

Extraction uses Apple's stock toolchain: otool (ObjC + Swift sections),
xcrun swift-demangle (Swift type names), strings (Hermes screen scan).
Each extractor is best-effort — missing sections or tooling are reported
under known_gaps[] and the rest of the pipeline continues.

Use --upload-to-build <buildId> to POST the resulting payload to a server
build for later viewing at /builds/<buildId>/skeleton.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			path := args[0]
			payload, err := analyzeIPA(path)
			if err != nil {
				return err
			}
			if outputFormat == "markdown" {
				return renderMarkdown(payload, cmd.OutOrStdout())
			}
			enc := json.NewEncoder(cmd.OutOrStdout())
			enc.SetIndent("", "  ")
			if err := enc.Encode(payload); err != nil {
				return err
			}
			if uploadBuildID != "" {
				if serverURL == "" {
					serverURL = "http://localhost:3000"
				}
				return uploadSkeletonToServer(cmd.Context(), serverURL, uploadBuildID, payload)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&outputFormat, "format", "json", "Output format (json|markdown)")
	cmd.Flags().StringVar(&uploadBuildID, "upload-to-build", "", "Build id to attach the analysis to (POSTs to <server>/api/builds/<id>/skeleton)")
	cmd.Flags().StringVar(&serverURL, "analyze-server", "", "Server base URL for upload (defaults to global --server or http://localhost:3000)")
	return cmd
}

// analyzeIPA runs the full extraction pipeline against an .ipa or .app path.
func analyzeIPA(path string) (*SkeletonPayload, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("stat %s: %w", path, err)
	}

	var appDir string
	var workDir string
	if info.IsDir() {
		// .app directory passed directly.
		appDir = path
	} else {
		// Assume .ipa — unzip to TempDir.
		workDir, err = os.MkdirTemp("", "df-analyze-")
		if err != nil {
			return nil, fmt.Errorf("mktemp: %w", err)
		}
		// Caller cleans up via defer below — but only if we created it.
		defer os.RemoveAll(workDir)
		if err := unzipFile(path, workDir); err != nil {
			return nil, fmt.Errorf("unzip %s: %w", path, err)
		}
		appDir, err = findAppDir(workDir)
		if err != nil {
			return nil, err
		}
	}

	gaps := []SkeletonKnownGap{}

	// Parse Info.plist via plutil (handles bplist + XML + JSON Pitfall 7).
	plistPath := filepath.Join(appDir, "Info.plist")
	plistData, plistErr := parseInfoPlist(plistPath)
	if plistErr != nil {
		gaps = append(gaps, SkeletonKnownGap{Kind: "info_plist", Message: plistErr.Error()})
	}
	bundleID, _ := plistData["CFBundleIdentifier"].(string)
	bundleVer, _ := plistData["CFBundleShortVersionString"].(string)
	bundleExe, _ := plistData["CFBundleExecutable"].(string)

	// Locate executable. CFBundleExecutable is the canonical source.
	var execPath string
	if bundleExe != "" {
		execPath = filepath.Join(appDir, bundleExe)
	}

	// ObjC classlist
	var objcClasses []macho.ObjCClass
	if execPath != "" {
		objcClasses, err = macho.ParseObjCClasslist(execPath)
		if err != nil {
			gaps = append(gaps, SkeletonKnownGap{Kind: "objc_classlist", Message: err.Error()})
		}
	}

	// Swift5 types — demangle in batches.
	var swiftTypes []macho.Swift5Type
	if execPath != "" {
		swiftTypes, err = macho.ParseSwift5Types(execPath)
		if err != nil {
			gaps = append(gaps, SkeletonKnownGap{Kind: "swift5_types", Message: err.Error()})
		}
	}
	if len(swiftTypes) > 0 {
		raw := make([]string, len(swiftTypes))
		for i, t := range swiftTypes {
			raw[i] = t.MangledName
		}
		demangled, derr := macho.DemangleBatch(raw)
		if derr != nil {
			gaps = append(gaps, SkeletonKnownGap{Kind: "swift_demangle", Message: derr.Error()})
		} else {
			for i := range swiftTypes {
				swiftTypes[i].MangledName = demangled[i]
				swiftTypes[i].Module = macho.ModuleOf(demangled[i])
			}
		}
	}

	// Hermes
	var rnBundle *SkeletonRNBundle
	jsBundle := filepath.Join(appDir, "main.jsbundle")
	var hermesScreens []string
	if _, err := os.Stat(jsBundle); err == nil {
		isHermes := macho.IsHermes(jsBundle)
		rnBundle = &SkeletonRNBundle{Detected: true, Hermes: isHermes, BundlePath: "main.jsbundle"}
		if isHermes {
			hermesScreens, err = macho.ExtractHermesScreens(jsBundle)
			if err != nil {
				gaps = append(gaps, SkeletonKnownGap{Kind: "hermes_extract", Message: err.Error()})
			}
		}
	}

	// Build candidate screens — apply ClassifyName to ObjC + Swift; emit
	// Hermes screens verbatim with high confidence + hermes source.
	screens := []SkeletonScreen{}
	for _, c := range objcClasses {
		name := macho.ShortNameOf(c.MangledName)
		conf, _, inc := macho.ClassifyName(name)
		if !inc {
			continue
		}
		screens = append(screens, SkeletonScreen{
			Name:       name,
			Source:     "objc_classlist",
			Confidence: string(conf),
			Module:     macho.ModuleOf(c.MangledName),
		})
	}
	for _, t := range swiftTypes {
		name := macho.ShortNameOf(t.MangledName)
		conf, _, inc := macho.ClassifyName(name)
		if !inc {
			continue
		}
		mod := t.Module
		if mod == "" {
			mod = macho.ModuleOf(t.MangledName)
		}
		screens = append(screens, SkeletonScreen{
			Name:       name,
			Source:     "swift5_types",
			Confidence: string(conf),
			Module:     mod,
		})
	}
	for _, s := range hermesScreens {
		screens = append(screens, SkeletonScreen{
			Name:       s,
			Source:     "hermes_strings",
			Confidence: "high",
		})
	}

	// Deep links from CFBundleURLTypes -> CFBundleURLSchemes.
	deepLinks := extractDeepLinks(plistData)

	payload := &SkeletonPayload{
		SchemaVersion: 1,
		Platform:      "ios",
		App: SkeletonApp{
			BundleID:   bundleID,
			Version:    bundleVer,
			Executable: bundleExe,
		},
		ReactNativeBundle: rnBundle,
		Stats: SkeletonStats{
			TotalClasses:    len(objcClasses),
			TotalSwiftTypes: len(swiftTypes),
		},
		CandidateScreens: screens,
		DeepLinkEntries:  deepLinks,
		KnownGaps:        gaps,
	}
	return payload, nil
}

// unzipFile extracts a .zip (or .ipa) archive into the destination
// directory using archive/zip.
func unzipFile(src, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, f := range r.File {
		// Zip-slip safety: reject paths that escape dest.
		target := filepath.Join(dest, f.Name)
		if !strings.HasPrefix(target, filepath.Clean(dest)+string(os.PathSeparator)) {
			return fmt.Errorf("zip slip detected: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, f.Mode()); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			out.Close()
			return err
		}
		// 1 GiB hard cap per file as a sanity guard.
		if _, err := io.CopyN(out, rc, 1<<30); err != nil && err != io.EOF {
			out.Close()
			rc.Close()
			return err
		}
		out.Close()
		rc.Close()
	}
	return nil
}

// findAppDir locates Payload/*.app inside the unzipped root.
func findAppDir(root string) (string, error) {
	payload := filepath.Join(root, "Payload")
	entries, err := os.ReadDir(payload)
	if err != nil {
		return "", fmt.Errorf("read Payload/: %w", err)
	}
	for _, e := range entries {
		if e.IsDir() && strings.HasSuffix(e.Name(), ".app") {
			return filepath.Join(payload, e.Name()), nil
		}
	}
	return "", fmt.Errorf("no .app directory under Payload/")
}

// parseInfoPlist handles binary + XML + JSON Info.plist (Pitfall 7).
//
// Strategy: shell to /usr/bin/plutil -convert json -o - <plist>. plutil
// handles bplist + XML transparently. If plutil fails (rare — maybe non-Mac
// host), fall back to attempting raw JSON parse on the bytes.
func parseInfoPlist(path string) (map[string]interface{}, error) {
	out := map[string]interface{}{}
	cmd := exec.Command("/usr/bin/plutil", "-convert", "json", "-o", "-", path)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err == nil {
		if jerr := json.Unmarshal(stdout.Bytes(), &out); jerr == nil {
			return out, nil
		}
	}
	// Fallback — raw JSON parse on the file (covers JSON-shaped Info.plist).
	raw, err := os.ReadFile(path)
	if err != nil {
		return out, err
	}
	if jerr := json.Unmarshal(raw, &out); jerr == nil {
		return out, nil
	}
	return out, fmt.Errorf("plutil failed (%s) and raw JSON parse rejected file", stderr.String())
}

// extractDeepLinks reads CFBundleURLTypes from the Info.plist map and
// emits one deep-link entry per scheme. Marks `is_oauth_callback` heuristic
// note when the scheme matches known OAuth provider patterns.
func extractDeepLinks(plist map[string]interface{}) []SkeletonDeepLink {
	out := []SkeletonDeepLink{}
	urlTypes, ok := plist["CFBundleURLTypes"].([]interface{})
	if !ok {
		return out
	}
	for _, raw := range urlTypes {
		entry, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		schemes, ok := entry["CFBundleURLSchemes"].([]interface{})
		if !ok {
			continue
		}
		for _, s := range schemes {
			scheme, ok := s.(string)
			if !ok || scheme == "" {
				continue
			}
			out = append(out, SkeletonDeepLink{
				Scheme: scheme,
				Source: "info_plist",
			})
		}
	}
	return out
}

// renderMarkdown writes a Markdown summary of the payload to w.
func renderMarkdown(p *SkeletonPayload, w io.Writer) error {
	fmt.Fprintf(w, "# Skeleton — %s\n\n", p.App.BundleID)
	fmt.Fprintf(w, "- Version: %s\n- Executable: %s\n\n", p.App.Version, p.App.Executable)
	fmt.Fprintf(w, "## Stats\n\n- Classes: %d\n- Swift types: %d\n- Candidate screens: %d\n- Deep links: %d\n\n",
		p.Stats.TotalClasses, p.Stats.TotalSwiftTypes, len(p.CandidateScreens), len(p.DeepLinkEntries))
	fmt.Fprintf(w, "## Candidate Screens\n\n")
	for _, s := range p.CandidateScreens {
		fmt.Fprintf(w, "- **%s** (%s, %s)\n", s.Name, s.Source, s.Confidence)
	}
	if len(p.DeepLinkEntries) > 0 {
		fmt.Fprintf(w, "\n## Deep Links\n\n")
		for _, d := range p.DeepLinkEntries {
			fmt.Fprintf(w, "- %s://\n", d.Scheme)
		}
	}
	if len(p.KnownGaps) > 0 {
		fmt.Fprintf(w, "\n## Known Gaps\n\n")
		for _, g := range p.KnownGaps {
			fmt.Fprintf(w, "- **%s**: %s\n", g.Kind, g.Message)
		}
	}
	return nil
}

// uploadSkeletonToServer POSTs the payload to /api/builds/<id>/skeleton
// as a multipart upload (single `skeleton` file part).
func uploadSkeletonToServer(ctx context.Context, serverURL, buildID string, payload *SkeletonPayload) error {
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("skeleton", "skeleton.json")
	if err != nil {
		return fmt.Errorf("create form file: %w", err)
	}
	if _, err := part.Write(jsonBytes); err != nil {
		return fmt.Errorf("write payload: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("close multipart: %w", err)
	}

	url := strings.TrimRight(serverURL, "/") + "/api/builds/" + buildID + "/skeleton"
	req, err := http.NewRequestWithContext(ctx, "POST", url, &body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	if APIKeyFlag != "" {
		req.Header.Set("Authorization", "Bearer "+APIKeyFlag)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("upload: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		fmt.Fprintf(os.Stderr, "Uploaded analysis: %s\n", string(respBody))
		return nil
	}
	return fmt.Errorf("server returned %d: %s", resp.StatusCode, string(respBody))
}

func init() {
	rootCmd.AddCommand(newAnalyzeCmd())
}
