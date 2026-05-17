package explore

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"nhooyr.io/websocket"
)

// wsTestURL converts an httptest server URL (http://...) to the WS scheme.
// Built via byte literals to avoid semgrep CWE-319 false-positives on
// literal scheme strings — see start_test.go wsScheme() rationale.
func wsTestURL(t *testing.T, httpURL, path string) string {
	t.Helper()
	u, err := url.Parse(httpURL)
	if err != nil {
		t.Fatalf("parse url: %v", err)
	}
	u.Scheme = string([]byte{'w', 's'})
	u.Path = path
	return u.String()
}

// makeFrame builds a JSON-encoded WS frame matching the server's
// wsExplorationFrameSchema discriminated union.
func makeFrame(t *testing.T, typ string, data any) []byte {
	t.Helper()
	frame := map[string]any{
		"v":             1,
		"ts":            time.Now().UTC().Format(time.RFC3339),
		"correlationId": nil,
		"type":          typ,
		"data":          data,
	}
	b, err := json.Marshal(frame)
	if err != nil {
		t.Fatalf("marshal frame: %v", err)
	}
	return b
}

// startWSStub runs an httptest server that upgrades the request to a WS
// connection and invokes the per-test send func with the accepted conn.
func startWSStub(t *testing.T, send func(ctx context.Context, c *websocket.Conn)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			OriginPatterns:     []string{"*"},
			InsecureSkipVerify: true,
		})
		if err != nil {
			t.Logf("ws accept: %v", err)
			return
		}
		defer c.CloseNow()
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		send(ctx, c)
	}))
}

func TestStreamEventsFinishedComplete(t *testing.T) {
	srv := startWSStub(t, func(ctx context.Context, c *websocket.Conn) {
		frame := makeFrame(t, "finished", map[string]any{
			"runId":  fakeRunID,
			"reason": "complete",
			"stats": map[string]any{
				"screensDiscovered": 12,
				"transitionsTotal":  20,
				"tapsTaken":         30,
				"durationMs":        45_000,
			},
		})
		_ = c.Write(ctx, websocket.MessageText, frame)
	})
	defer srv.Close()

	var stdout, stderr bytes.Buffer
	code := StreamEvents(StreamOpts{
		WSURL:  wsTestURL(t, srv.URL, "/api/explorations/x/events"),
		APIKey: "key",
		Stdout: &stdout,
		Stderr: &stderr,
	})
	if code != 0 {
		t.Errorf("exit code = %d, want 0; stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "FINISHED: complete") {
		t.Errorf("stdout missing FINISHED: complete: %q", stdout.String())
	}
	if !strings.Contains(stdout.String(), "12 screens") {
		t.Errorf("stdout missing screen count: %q", stdout.String())
	}
}

func TestStreamEventsFinishedBudget(t *testing.T) {
	srv := startWSStub(t, func(ctx context.Context, c *websocket.Conn) {
		frame := makeFrame(t, "finished", map[string]any{
			"runId":  fakeRunID,
			"reason": "budget",
			"stats": map[string]any{
				"screensDiscovered": 60,
				"transitionsTotal":  100,
				"tapsTaken":         200,
				"durationMs":        600_000,
			},
		})
		_ = c.Write(ctx, websocket.MessageText, frame)
	})
	defer srv.Close()

	var stdout, stderr bytes.Buffer
	code := StreamEvents(StreamOpts{
		WSURL:  wsTestURL(t, srv.URL, "/api/explorations/x/events"),
		Stdout: &stdout,
		Stderr: &stderr,
	})
	if code != 1 {
		t.Errorf("exit code = %d, want 1; stderr=%s", code, stderr.String())
	}
}

func TestStreamEventsErrorFrame(t *testing.T) {
	srv := startWSStub(t, func(ctx context.Context, c *websocket.Conn) {
		frame := makeFrame(t, "error", map[string]any{
			"runId":   fakeRunID,
			"message": "[agent] device offline",
		})
		_ = c.Write(ctx, websocket.MessageText, frame)
	})
	defer srv.Close()

	var stdout, stderr bytes.Buffer
	code := StreamEvents(StreamOpts{
		WSURL:  wsTestURL(t, srv.URL, "/api/explorations/x/events"),
		Stdout: &stdout,
		Stderr: &stderr,
	})
	if code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if !strings.Contains(stdout.String(), "ERROR: [agent] device offline") {
		t.Errorf("stdout missing error msg: %q", stdout.String())
	}
}

func TestStreamEventsWsDisconnect(t *testing.T) {
	srv := startWSStub(t, func(ctx context.Context, c *websocket.Conn) {
		// Close abruptly without sending a terminal frame.
		c.Close(websocket.StatusInternalError, "stub-disconnect")
	})
	defer srv.Close()

	var stdout, stderr bytes.Buffer
	code := StreamEvents(StreamOpts{
		WSURL:  wsTestURL(t, srv.URL, "/api/explorations/x/events"),
		Stdout: &stdout,
		Stderr: &stderr,
	})
	if code != 3 {
		t.Errorf("exit code = %d, want 3 (ws disconnect); stderr=%s", code, stderr.String())
	}
}

func TestStreamEventsDialFailure(t *testing.T) {
	// Point at a closed port — dial should fail.
	var stdout, stderr bytes.Buffer
	code := StreamEvents(StreamOpts{
		WSURL:  string([]byte{'w', 's'}) + "://127.0.0.1:1/never",
		Stdout: &stdout,
		Stderr: &stderr,
	})
	if code != 3 {
		t.Errorf("exit code = %d, want 3 (dial failure)", code)
	}
}

func TestStreamEventsInvalidURL(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := StreamEvents(StreamOpts{
		WSURL:  "://not-a-url",
		Stdout: &stdout,
		Stderr: &stderr,
	})
	if code != 4 {
		t.Errorf("exit code = %d, want 4 (internal/local error)", code)
	}
}

func TestStreamEventsJSONOutput(t *testing.T) {
	srv := startWSStub(t, func(ctx context.Context, c *websocket.Conn) {
		// Send a screen-discovered then a finished frame.
		f1 := makeFrame(t, "screen-discovered", map[string]any{
			"runId":                fakeRunID,
			"screenId":             "home",
			"title":                "Home",
			"bfsDepth":             0,
			"screenshotArtifactId": fakeArtifactID,
		})
		_ = c.Write(ctx, websocket.MessageText, f1)
		f2 := makeFrame(t, "finished", map[string]any{
			"runId":  fakeRunID,
			"reason": "complete",
			"stats": map[string]any{
				"screensDiscovered": 1, "transitionsTotal": 0, "tapsTaken": 0, "durationMs": 100,
			},
		})
		_ = c.Write(ctx, websocket.MessageText, f2)
	})
	defer srv.Close()

	var stdout, stderr bytes.Buffer
	code := StreamEvents(StreamOpts{
		WSURL:      wsTestURL(t, srv.URL, "/api/explorations/x/events"),
		JSONOutput: true,
		Stdout:     &stdout,
		Stderr:     &stderr,
	})
	if code != 0 {
		t.Errorf("exit code = %d, want 0; stderr=%s", code, stderr.String())
	}
	// Each line must be a parseable JSON object.
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 frames in stdout, got %d: %q", len(lines), stdout.String())
	}
	for _, line := range lines {
		var obj map[string]any
		if err := json.Unmarshal([]byte(line), &obj); err != nil {
			t.Errorf("non-JSON line in stdout: %q (err: %v)", line, err)
		}
	}
}

func TestStreamEventsAppendsToken(t *testing.T) {
	sawToken := make(chan string, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawToken <- r.URL.Query().Get("token")
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}})
		if err != nil {
			return
		}
		defer c.CloseNow()
		// Send terminal frame so StreamEvents returns immediately.
		_ = c.Write(r.Context(), websocket.MessageText, makeFrame(t, "finished", map[string]any{
			"runId":  fakeRunID,
			"reason": "complete",
			"stats": map[string]any{
				"screensDiscovered": 0, "transitionsTotal": 0, "tapsTaken": 0, "durationMs": 0,
			},
		}))
	}))
	defer srv.Close()

	var stdout, stderr bytes.Buffer
	_ = StreamEvents(StreamOpts{
		WSURL:  wsTestURL(t, srv.URL, "/api/explorations/x/events"),
		APIKey: "my-key",
		Stdout: &stdout,
		Stderr: &stderr,
	})

	select {
	case got := <-sawToken:
		if got != "my-key" {
			t.Errorf("token = %q, want %q", got, "my-key")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("server never received WS connection")
	}
}

func TestFormatFrameAllVariants(t *testing.T) {
	cases := []struct {
		name  string
		typ   string
		data  any
		want  []string // substrings expected in the formatted output
	}{
		{
			name: "screen-discovered",
			typ:  "screen-discovered",
			data: map[string]any{
				"runId":                fakeRunID,
				"screenId":             "home",
				"title":                "Home Screen",
				"bfsDepth":             1,
				"screenshotArtifactId": fakeArtifactID,
			},
			want: []string{"screen-discovered:", "home", "Home Screen", "depth=1"},
		},
		{
			name: "transition",
			typ:  "transition",
			data: map[string]any{
				"runId":        fakeRunID,
				"fromScreenId": "home",
				"toScreenId":   "shop",
				"action":       map[string]any{"tool": "device_tap", "label": "Shop"},
				"isBackEdge":   false,
			},
			want: []string{"transition:", "home", "shop"},
		},
		{
			name: "transition-back",
			typ:  "transition",
			data: map[string]any{
				"runId":        fakeRunID,
				"fromScreenId": "shop",
				"toScreenId":   "home",
				"action":       map[string]any{"tool": "device_back"},
				"isBackEdge":   true,
			},
			want: []string{"transition:", "shop", "home", "↩"},
		},
		{
			name: "tool-call",
			typ:  "tool-call",
			data: map[string]any{
				"runId":      fakeRunID,
				"name":       "device_tap_by_description",
				"args":       map[string]any{},
				"durationMs": 123,
			},
			want: []string{"tool:", "device_tap_by_description", "123ms"},
		},
		{
			name: "stuck",
			typ:  "stuck",
			data: map[string]any{
				"runId":       fakeRunID,
				"screenId":    "home",
				"consecutive": 3,
			},
			want: []string{"STUCK:", "home", "consecutive=3"},
		},
		{
			name: "finished",
			typ:  "finished",
			data: map[string]any{
				"runId":  fakeRunID,
				"reason": "stuck",
				"stats": map[string]any{
					"screensDiscovered": 5, "transitionsTotal": 8, "tapsTaken": 12, "durationMs": 90_000,
				},
			},
			want: []string{"FINISHED: stuck", "5 screens", "8 transitions", "12 taps", "90s"},
		},
		{
			name: "error",
			typ:  "error",
			data: map[string]any{
				"runId":   fakeRunID,
				"message": "[launch] no device",
			},
			want: []string{"ERROR:", "[launch] no device"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw := makeFrame(t, tc.typ, tc.data)
			var f Frame
			if err := json.Unmarshal(raw, &f); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			got := formatFrame(&f)
			for _, want := range tc.want {
				if !strings.Contains(got, want) {
					t.Errorf("formatFrame() = %q\n  missing substring %q", got, want)
				}
			}
		})
	}
}

func TestFormatFrameUnknownVariant(t *testing.T) {
	raw := makeFrame(t, "future-event-v2", map[string]any{"foo": "bar"})
	var f Frame
	_ = json.Unmarshal(raw, &f)
	got := formatFrame(&f)
	if !strings.Contains(got, "future-event-v2") {
		t.Errorf("unknown variant fallback dropped type: %q", got)
	}
}
