# Phase 7: CLI WebSocket Auth Token - Research

**Researched:** 2026-03-11
**Domain:** Go CLI WebSocket authentication (gap closure)
**Confidence:** HIGH

## Summary

This phase closes the last v1.0 gap: the CLI's `buildWSURL` function constructs WebSocket URLs without appending the authentication token. When the server has `auth.enabled=true`, the WebSocket plugin at `server/streaming/websocket-plugin.ts` checks `req.query.token` and calls `validateKey()`. Without this query parameter, the server closes the connection with code 1008 ("Policy violation"), breaking both `device-farm run` (streaming mode) and `device-farm logs --follow`.

The fix is narrow and well-defined. The `buildWSURL` function in `cli/cmd/run.go` must accept the API key and append `?token=<apiKey>` to the WebSocket URL. Both `runRun` and `followLogs` already resolve the API key via `config.ResolveAPIKey(APIKeyFlag)` -- they just need to pass it through to `buildWSURL`. No server changes are needed; the server-side token query parameter validation is already implemented and tested.

**Primary recommendation:** Modify `buildWSURL` to accept an `apiKey` parameter and append `?token=<apiKey>` when non-empty. Update both call sites (`run.go` line 103, `logs.go` line 85). Add unit tests for the updated function. This is a 1-plan phase.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLI-01 | `device-farm run` -- envia YAML files, conecta WebSocket, streama logs, exit 0/1 | buildWSURL must append token so WS connection succeeds with auth.enabled=true |
| CLI-03 | `device-farm logs <job-id>` -- logs completos ou --follow para streaming | followLogs uses same buildWSURL; same fix applies |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| nhooyr.io/websocket | v1.8.17 | WebSocket client | Already in use, pure Go, context-aware |
| cobra | v1.10.2 | CLI framework | Already in use |
| net/url | stdlib | URL query parameter encoding | Standard library, handles special characters |

### Supporting
No new libraries needed. This is a modification to existing code.

## Architecture Patterns

### Current Code Flow (Broken)
```
run.go:runRun() -> buildWSURL(serverURL, "/ws/jobs/"+job.ID) -> ws://host/ws/jobs/123
                                                                  ^ missing ?token=apiKey

logs.go:followLogs() -> buildWSURL(serverURL, "/ws/jobs/"+jobID) -> ws://host/ws/jobs/123
                                                                     ^ missing ?token=apiKey
```

### Fixed Code Flow
```
run.go:runRun() -> buildWSURL(serverURL, "/ws/jobs/"+job.ID, apiKey) -> ws://host/ws/jobs/123?token=df_abc123
logs.go:followLogs() -> buildWSURL(serverURL, "/ws/jobs/"+jobID, apiKey) -> ws://host/ws/jobs/123?token=df_abc123
```

### Server-Side Auth Flow (Already Implemented)
```
websocket-plugin.ts:
  1. Client connects to /ws/jobs/:id
  2. If auth.enabled && authService exists:
     - Read req.query.token
     - Call authService.validateKey(token)
     - If invalid/missing: socket.close(1008, 'Policy violation')
  3. Otherwise: proceed with normal streaming
```

### Key Code Locations

| File | Line(s) | What to Change |
|------|---------|----------------|
| `cli/cmd/run.go` | 125-133 | `buildWSURL` function signature: add `apiKey string` parameter |
| `cli/cmd/run.go` | 103 | Call site: pass `apiKey` to `buildWSURL` |
| `cli/cmd/logs.go` | 85 | Call site: pass `apiKey` to `buildWSURL` |

### Anti-Patterns to Avoid
- **Do NOT use HTTP headers for WS auth:** The server reads from `req.query.token`, not from headers. The `@fastify/websocket` plugin exposes query params, not custom headers from the upgrade request in a reliable way.
- **Do NOT URL-encode the token manually:** Use `net/url.Values` or direct string concatenation since API keys are alphanumeric (`df_` prefix + hex chars). But using `url.Values.Encode()` is safer and handles edge cases.
- **Do NOT change the server side:** The server-side validation is already correct and tested. This is a CLI-only fix.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL query parameter encoding | Manual string concatenation with `?` and `&` | `net/url.URL` with `Query().Set()` then `RawQuery` | Handles special chars, multiple params, existing query strings |

## Common Pitfalls

### Pitfall 1: Empty API Key Still Appends Token
**What goes wrong:** `?token=` in URL when no API key is configured (auth disabled on server)
**Why it happens:** Not checking for empty string before appending
**How to avoid:** Only append `?token=<key>` when `apiKey != ""`
**Warning signs:** Server logs show empty token validation attempts

### Pitfall 2: Forgetting One Call Site
**What goes wrong:** `run` works but `logs --follow` still gets 1008, or vice versa
**Why it happens:** Two separate call sites to `buildWSURL` in different files
**How to avoid:** Update BOTH `run.go` line 103 and `logs.go` line 85
**Warning signs:** One command works, the other disconnects immediately

### Pitfall 3: Token in nhooyr.io/websocket HTTPHeader Instead of URL
**What goes wrong:** Server doesn't see the token because it reads from query params, not headers
**Why it happens:** Assuming WS auth works like HTTP Bearer auth
**How to avoid:** The server explicitly reads `(req.query as Record<string, string>).token` -- must be in URL query string
**Warning signs:** 1008 disconnect even with token configured

### Pitfall 4: Not Testing with Auth Disabled
**What goes wrong:** Regression when auth.enabled=false -- URL has unnecessary query param
**Why it happens:** Only testing the auth-enabled path
**How to avoid:** Test both paths: empty apiKey produces clean URL, non-empty apiKey appends token

## Code Examples

### buildWSURL Fix (Recommended Implementation)
```go
// Source: cli/cmd/run.go (to be modified)

// buildWSURL replaces http(s):// with ws(s):// and appends the path.
// If apiKey is non-empty, appends ?token=<apiKey> for WebSocket auth.
func buildWSURL(serverURL, path, apiKey string) string {
	wsURL := serverURL
	if strings.HasPrefix(wsURL, "https://") {
		wsURL = "wss://" + wsURL[len("https://"):]
	} else if strings.HasPrefix(wsURL, "http://") {
		wsURL = "ws://" + wsURL[len("http://"):]
	}
	wsURL += path
	if apiKey != "" {
		wsURL += "?token=" + apiKey
	}
	return wsURL
}
```

### Updated Call Sites

**run.go:**
```go
// Line ~66: apiKey is already resolved
apiKey := config.ResolveAPIKey(APIKeyFlag)

// Line ~103: pass apiKey
wsURL := buildWSURL(serverURL, "/ws/jobs/"+job.ID, apiKey)
```

**logs.go:**
```go
// Line ~37: apiKey is already resolved
apiKey := config.ResolveAPIKey(APIKeyFlag)

// Line ~85: pass apiKey (apiKey available via closure from runLogs)
wsURL := buildWSURL(serverURL, "/ws/jobs/"+jobID, apiKey)
```

Note: In `logs.go`, `followLogs` receives `serverURL` but not `apiKey`. The function signature needs to be updated to also receive `apiKey string`, or `apiKey` needs to be resolved within `followLogs`. Looking at the current code, `apiKey` is resolved in `runLogs` and passed to `NewClient` but not to `followLogs`. The simplest fix is to add `apiKey` as a parameter to `followLogs`.

### Unit Test for buildWSURL
```go
func TestBuildWSURL(t *testing.T) {
	tests := []struct {
		name      string
		serverURL string
		path      string
		apiKey    string
		want      string
	}{
		{"http without key", "http://localhost:3000", "/ws/jobs/abc", "", "ws://localhost:3000/ws/jobs/abc"},
		{"http with key", "http://localhost:3000", "/ws/jobs/abc", "df_test123", "ws://localhost:3000/ws/jobs/abc?token=df_test123"},
		{"https without key", "https://farm.example.com", "/ws/jobs/abc", "", "wss://farm.example.com/ws/jobs/abc"},
		{"https with key", "https://farm.example.com", "/ws/jobs/abc", "df_test123", "wss://farm.example.com/ws/jobs/abc?token=df_test123"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildWSURL(tt.serverURL, tt.path, tt.apiKey)
			if got != tt.want {
				t.Errorf("buildWSURL(%q, %q, %q) = %q, want %q", tt.serverURL, tt.path, tt.apiKey, got, tt.want)
			}
		})
	}
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WS auth via headers | WS auth via query param `?token=` | Phase 06-04 (server side) | CLI must match server expectation |

This is not a technology evolution issue -- it is a gap where the server-side was implemented (Phase 06-04) but the CLI-side was not updated to match.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Go testing (stdlib) |
| Config file | None needed (Go convention) |
| Quick run command | `cd cli && go test ./cmd/ -run TestBuildWSURL -count=1` |
| Full suite command | `cd cli && go test ./... -count=1` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLI-01 | buildWSURL appends token for `run` | unit | `cd cli && go test ./cmd/ -run TestBuildWSURL -count=1` | No -- Wave 0 |
| CLI-03 | buildWSURL appends token for `logs --follow` | unit | `cd cli && go test ./cmd/ -run TestBuildWSURL -count=1` | No -- Wave 0 |
| CLI-01+03 | No 1008 disconnect with auth.enabled=true | manual-only | Requires running server with auth enabled | N/A |

### Sampling Rate
- **Per task commit:** `cd cli && go test ./cmd/ -run TestBuildWSURL -count=1`
- **Per wave merge:** `cd cli && go test ./... -count=1`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] `cli/cmd/run_test.go` -- TestBuildWSURL covering all 4 combinations (http/https x with/without key)

## Open Questions

None. The fix is well-defined:
1. Server already validates `req.query.token` (verified in `websocket-plugin.ts` lines 45-49, 102-107)
2. CLI already resolves API key (verified in `resolve.go`)
3. `buildWSURL` just needs the extra parameter and query string append
4. Both call sites are identified (`run.go:103`, `logs.go:85`)

## Sources

### Primary (HIGH confidence)
- Direct code inspection of `cli/cmd/run.go` -- `buildWSURL` function (lines 125-133)
- Direct code inspection of `cli/cmd/logs.go` -- `followLogs` call to `buildWSURL` (line 85)
- Direct code inspection of `server/streaming/websocket-plugin.ts` -- token validation (lines 44-49, 101-107)
- Direct code inspection of `cli/internal/config/resolve.go` -- `ResolveAPIKey` (lines 21-33)
- Direct code inspection of `cli/go.mod` -- nhooyr.io/websocket v1.8.17

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, modification to existing code only
- Architecture: HIGH - both server and client code inspected directly, gap is clear
- Pitfalls: HIGH - well-understood problem space, only 4 realistic pitfalls

**Research date:** 2026-03-11
**Valid until:** indefinite (gap closure for existing code, no external dependencies changing)
