// stream.go — WS event loop + human-readable formatter + exit-code mapping.
//
// Phase 35 Plan 35-04 (T-35.5) — connects to the WS endpoint shipped in
// Plan 35-03 (server/explorations/internal/events-ws.ts) and tails the
// 6-variant discriminated union (screen-discovered / transition / tool-call
// / stuck / finished / error) until a terminal frame arrives.
//
// Exit-code spec (matches plan must_haves[5]):
//
//	0 = finished with reason="complete"
//	1 = finished with reason in {budget,time,stuck,login_required,cancelled} OR error frame
//	3 = WS connection error (dial failure, mid-stream disconnect)
//	4 = local error (invalid URL, internal failure)
//
// HTTP startup errors (exit 2) and config errors (exit 4) are handled by
// the caller in cli/cmd/explore.go before StreamEvents is invoked.
package explore

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"time"

	"nhooyr.io/websocket"
)

// Frame is the wire-level shape — discriminated by `type`, with `data` left
// as raw bytes for per-variant decoding inside formatFrame. The CLI does not
// need to mirror the full Zod discriminated union from server/explorations/
// ws-schemas.ts because we only display the frames and exit on terminal.
type Frame struct {
	V             int             `json:"v"`
	Type          string          `json:"type"`
	TS            string          `json:"ts"`
	CorrelationID *string         `json:"correlationId"`
	Data          json.RawMessage `json:"data"`
}

// StreamOpts carries everything StreamEvents needs to open + tail the WS.
// Stdout/Stderr are pluggable so unit tests can capture output to a buffer.
type StreamOpts struct {
	ServerURL  string    // currently unused — kept for future reconnect/replay
	APIKey     string    // appended as ?token=<key> on the WS dial
	RunID      string    // currently unused — agentLogStreamUrl already carries it
	WSURL      string    // from StartResponse.AgentLogStreamURL
	JSONOutput bool      // true → emit raw JSONL on stdout; false → human-readable
	Stdout     io.Writer // defaults to os.Stdout
	Stderr     io.Writer // defaults to os.Stderr
}

// StreamEvents opens the WS, tails frames, prints to stdout, and returns
// the exit code derived from the terminal frame. Blocking call — returns
// only after either a terminal frame or an error condition.
func StreamEvents(opts StreamOpts) int {
	if opts.Stdout == nil {
		opts.Stdout = os.Stdout
	}
	if opts.Stderr == nil {
		opts.Stderr = os.Stderr
	}

	// Append ?token=<bearer> per Phase 22/35 WS auth convention
	// (browsers cannot set Authorization on WS upgrade).
	u, err := url.Parse(opts.WSURL)
	if err != nil {
		fmt.Fprintf(opts.Stderr, "invalid ws url %q: %v\n", opts.WSURL, err)
		return 4
	}
	if opts.APIKey != "" {
		q := u.Query()
		q.Set("token", opts.APIKey)
		u.RawQuery = q.Encode()
	}

	// 24h dial cap — explorations can run up to 7200s (2h) budget.
	ctx, cancel := context.WithTimeout(context.Background(), 24*time.Hour)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, u.String(), nil)
	if err != nil {
		fmt.Fprintf(opts.Stderr, "ws dial failed: %v\n", err)
		return 3
	}
	defer conn.CloseNow()

	// Server may replay up to 200 frames on connect + heartbeat pings.
	conn.SetReadLimit(1 << 20) // 1MB

	for {
		_, raw, err := conn.Read(ctx)
		if err != nil {
			// EOF or context cancellation surfaces as a read error here.
			fmt.Fprintf(opts.Stderr, "ws read: %v\n", err)
			return 3
		}
		var frame Frame
		if err := json.Unmarshal(raw, &frame); err != nil {
			fmt.Fprintf(opts.Stderr, "decode frame (skipping): %v\n", err)
			continue
		}

		// Print frame.
		if opts.JSONOutput {
			fmt.Fprintln(opts.Stdout, string(raw))
		} else {
			fmt.Fprintln(opts.Stdout, formatFrame(&frame))
		}

		// Terminal-frame check.
		switch frame.Type {
		case "finished":
			var d struct {
				Reason string `json:"reason"`
			}
			_ = json.Unmarshal(frame.Data, &d)
			if d.Reason == "complete" {
				return 0
			}
			return 1
		case "error":
			return 1
		}
	}
}

// formatFrame produces a one-line human-readable rendering for each of the
// 6 frame variants. Unknown variants fall through to a generic dump so a
// future server-side frame addition does not silently swallow events.
//
// Sample output (per plan must_haves[4]):
//
//	[12:34:56] screen-discovered: shop-tab — Shop tab (depth=2)
//	[12:34:57] transition: home → shop-tab
//	[12:34:58] STUCK: home (consecutive=3)
//	[12:35:00] FINISHED: complete (15 screens, 28 transitions, 42 taps, 312s)
func formatFrame(f *Frame) string {
	ts := f.TS
	if t, err := time.Parse(time.RFC3339, f.TS); err == nil {
		ts = t.Format("15:04:05")
	}

	switch f.Type {
	case "screen-discovered":
		var d struct {
			ScreenID string `json:"screenId"`
			Title    string `json:"title"`
			BFSDepth int    `json:"bfsDepth"`
		}
		_ = json.Unmarshal(f.Data, &d)
		return fmt.Sprintf("[%s] screen-discovered: %s — %s (depth=%d)", ts, d.ScreenID, d.Title, d.BFSDepth)

	case "transition":
		var d struct {
			FromScreenID string         `json:"fromScreenId"`
			ToScreenID   string         `json:"toScreenId"`
			Action       map[string]any `json:"action"`
			IsBackEdge   bool           `json:"isBackEdge"`
		}
		_ = json.Unmarshal(f.Data, &d)
		edge := "→"
		if d.IsBackEdge {
			edge = "↩"
		}
		actionLabel := actionSummary(d.Action)
		if actionLabel != "" {
			return fmt.Sprintf("[%s] transition: %s %s %s (%s)", ts, d.FromScreenID, edge, d.ToScreenID, actionLabel)
		}
		return fmt.Sprintf("[%s] transition: %s %s %s", ts, d.FromScreenID, edge, d.ToScreenID)

	case "tool-call":
		var d struct {
			Name       string `json:"name"`
			DurationMs int    `json:"durationMs"`
		}
		_ = json.Unmarshal(f.Data, &d)
		return fmt.Sprintf("[%s] tool: %s (%dms)", ts, d.Name, d.DurationMs)

	case "stuck":
		var d struct {
			ScreenID    string `json:"screenId"`
			Consecutive int    `json:"consecutive"`
		}
		_ = json.Unmarshal(f.Data, &d)
		return fmt.Sprintf("[%s] STUCK: %s (consecutive=%d)", ts, d.ScreenID, d.Consecutive)

	case "finished":
		var d struct {
			Reason string `json:"reason"`
			Stats  struct {
				ScreensDiscovered int `json:"screensDiscovered"`
				TransitionsTotal  int `json:"transitionsTotal"`
				TapsTaken         int `json:"tapsTaken"`
				DurationMs        int `json:"durationMs"`
			} `json:"stats"`
		}
		_ = json.Unmarshal(f.Data, &d)
		secs := d.Stats.DurationMs / 1000
		return fmt.Sprintf("[%s] FINISHED: %s (%d screens, %d transitions, %d taps, %ds)",
			ts, d.Reason,
			d.Stats.ScreensDiscovered, d.Stats.TransitionsTotal, d.Stats.TapsTaken, secs)

	case "error":
		var d struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(f.Data, &d)
		return fmt.Sprintf("[%s] ERROR: %s", ts, d.Message)
	}

	// Unknown variant — dump raw JSON so we don't silently lose information.
	return fmt.Sprintf("[%s] %s: %s", ts, f.Type, strings.TrimSpace(string(f.Data)))
}

// actionSummary reduces an opaque action object to a short label.
// Supports the common keys emitted by the agent runner — "tool", "label",
// "element". Returns "" when no useful label can be derived.
func actionSummary(action map[string]any) string {
	if action == nil {
		return ""
	}
	for _, key := range []string{"tool", "label", "element", "type"} {
		if v, ok := action[key]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	return ""
}
