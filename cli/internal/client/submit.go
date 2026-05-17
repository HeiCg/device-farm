package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
)

// FileEntry represents a file to upload with its local path and relative path for the form.
type FileEntry struct {
	LocalPath    string
	RelativePath string
}

// BootOptionsJSON mirrors the server-side bootOptionsSchema
// (server/config/schema.ts) for Phase 31 / Plan 31-03 / SC3.
//
// Field tags use the exact JSON keys the server expects:
//   - coldBoot:  default false (true → emulator argv -no-snapshot-load)
//   - noAudio:   default true  (true → emulator argv -no-audio)
//   - gpu:       'swiftshader_indirect' | 'host' | 'auto'
//
// Marshalled and submitted as a `boot_options` multipart field by
// BuildJobMultipart when bootOpts is non-nil.
type BootOptionsJSON struct {
	ColdBoot bool   `json:"coldBoot"`
	NoAudio  bool   `json:"noAudio"`
	Gpu      string `json:"gpu,omitempty"`
}

// SubmitJobOpts groups the args needed to build the multipart body.
// Used by both CreateJob (real HTTP submission) and BuildJobMultipart
// (test seam — unit-testable without an HTTP server).
type SubmitJobOpts struct {
	Files       []FileEntry
	Platform    string
	Metadata    map[string]string
	EnvVars     map[string]string
	ApkPath     string
	BootOptions *BootOptionsJSON
}

// BuildJobMultipart writes the multipart body for POST /api/jobs into `body`
// and returns the multipart content-type header value. Exported so tests can
// assert the on-the-wire shape without spinning up an HTTP server.
//
// Phase 31 / Plan 31-03 / SC3 — writes a `boot_options` JSON field only
// when opts.BootOptions is non-nil (preserves backward compat: server
// defaults apply when the field is absent).
func BuildJobMultipart(body *bytes.Buffer, opts SubmitJobOpts) (string, error) {
	writer := multipart.NewWriter(body)

	// Flow files
	for _, entry := range opts.Files {
		f, err := os.Open(entry.LocalPath)
		if err != nil {
			return "", fmt.Errorf("opening file %s: %w", entry.LocalPath, err)
		}
		part, err := writer.CreateFormFile("files", entry.RelativePath)
		if err != nil {
			f.Close()
			return "", fmt.Errorf("creating form file: %w", err)
		}
		if _, err := io.Copy(part, f); err != nil {
			f.Close()
			return "", fmt.Errorf("copying file %s: %w", entry.LocalPath, err)
		}
		f.Close()
	}

	// APK file
	if opts.ApkPath != "" {
		f, err := os.Open(opts.ApkPath)
		if err != nil {
			return "", fmt.Errorf("opening APK %s: %w", opts.ApkPath, err)
		}
		part, err := writer.CreateFormFile("apk", filepath.Base(opts.ApkPath))
		if err != nil {
			f.Close()
			return "", fmt.Errorf("creating APK form file: %w", err)
		}
		if _, err := io.Copy(part, f); err != nil {
			f.Close()
			return "", fmt.Errorf("copying APK %s: %w", opts.ApkPath, err)
		}
		f.Close()
	}

	// Platform field
	if opts.Platform != "" {
		if err := writer.WriteField("platform", opts.Platform); err != nil {
			return "", fmt.Errorf("writing platform field: %w", err)
		}
	}

	// Metadata
	if len(opts.Metadata) > 0 {
		metaJSON, err := json.Marshal(opts.Metadata)
		if err != nil {
			return "", fmt.Errorf("marshaling metadata: %w", err)
		}
		if err := writer.WriteField("metadata", string(metaJSON)); err != nil {
			return "", fmt.Errorf("writing metadata field: %w", err)
		}
	}

	// File paths (preserves directory structure)
	if len(opts.Files) > 0 {
		var paths []string
		for _, entry := range opts.Files {
			paths = append(paths, entry.RelativePath)
		}
		pathsJSON, err := json.Marshal(paths)
		if err != nil {
			return "", fmt.Errorf("marshaling file paths: %w", err)
		}
		if err := writer.WriteField("filePaths", string(pathsJSON)); err != nil {
			return "", fmt.Errorf("writing filePaths field: %w", err)
		}
	}

	// Env vars
	if len(opts.EnvVars) > 0 {
		envJSON, err := json.Marshal(opts.EnvVars)
		if err != nil {
			return "", fmt.Errorf("marshaling env vars: %w", err)
		}
		if err := writer.WriteField("env", string(envJSON)); err != nil {
			return "", fmt.Errorf("writing env field: %w", err)
		}
	}

	// Phase 31 / Plan 31-03 / SC3 — boot_options JSON field.
	// Omitted entirely when nil so server defaults apply.
	if opts.BootOptions != nil {
		bootJSON, err := json.Marshal(opts.BootOptions)
		if err != nil {
			return "", fmt.Errorf("marshaling boot_options: %w", err)
		}
		if err := writer.WriteField("boot_options", string(bootJSON)); err != nil {
			return "", fmt.Errorf("writing boot_options field: %w", err)
		}
	}

	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("closing multipart writer: %w", err)
	}

	return writer.FormDataContentType(), nil
}

// CreateJob submits flow files via multipart POST to /api/jobs.
//
// Phase 31 / Plan 31-03 / SC3 — accepts an optional *BootOptionsJSON
// emitted as the `boot_options` multipart field. Pass nil to preserve
// pre-Phase-31 behavior (server defaults apply).
func (c *Client) CreateJob(
	ctx context.Context,
	files []FileEntry,
	platform string,
	metadata map[string]string,
	envVars map[string]string,
	apkPath string,
	bootOpts *BootOptionsJSON,
) (*Job, error) {
	var body bytes.Buffer
	contentType, err := BuildJobMultipart(&body, SubmitJobOpts{
		Files:       files,
		Platform:    platform,
		Metadata:    metadata,
		EnvVars:     envVars,
		ApkPath:     apkPath,
		BootOptions: bootOpts,
	})
	if err != nil {
		return nil, &ExitError{Code: 2, Message: err.Error()}
	}

	resp, err := c.Do(ctx, "POST", "/api/jobs", &body, contentType)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 201 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, &ExitError{Code: 2, Message: fmt.Sprintf("unexpected status %d: %s", resp.StatusCode, string(respBody))}
	}

	var job Job
	if err := json.NewDecoder(resp.Body).Decode(&job); err != nil {
		return nil, &ExitError{Code: 2, Message: fmt.Sprintf("decoding job response: %v", err)}
	}

	return &job, nil
}
