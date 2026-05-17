package streaming

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"nhooyr.io/websocket"
)

// UnwrapBatch decodes the outer transport envelope.
//
// As of Phase 31 (SC2) the server defaults to batching outbound frames into a
// single `{"type":"batch","items":[...]}` envelope per 150ms window. This
// helper peels off that outer wrapper so the caller's existing per-frame
// dispatch logic continues to work unchanged.
//
//   - When the outer JSON is a batch envelope, returns each inner item as a
//     raw JSON message in order.
//   - When the outer JSON is any other type (or the legacy unbatched shape
//     served when the client connects with ?nobatch=1), returns
//     []json.RawMessage{raw} as a passthrough so the receive loop dispatches
//     it directly.
//   - When the outer JSON is malformed, returns (nil, err).
//   - When the outer JSON is a batch envelope with a null or missing items
//     field, returns an empty slice and no error.
func UnwrapBatch(raw []byte) ([]json.RawMessage, error) {
	var peek struct {
		Type  string            `json:"type"`
		Items []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(raw, &peek); err != nil {
		return nil, err
	}
	if peek.Type == "batch" {
		if peek.Items == nil {
			return []json.RawMessage{}, nil
		}
		return peek.Items, nil
	}
	return []json.RawMessage{raw}, nil
}

// StreamJob connects to the WebSocket at wsURL and dispatches messages to handler.
// It returns the exit code (0=passed, 1=failed, 2=error), a summary, and any error.
func StreamJob(ctx context.Context, wsURL string, handler MessageHandler) (int, *JobSummary, error) {
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{},
	})
	if err != nil {
		return 2, nil, fmt.Errorf("connecting to WebSocket: %w", err)
	}
	defer conn.CloseNow()

	// Allow large messages (server ring buffer replay can be big)
	conn.SetReadLimit(1 << 20) // 1MB

	var finalStatus string

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			// Context cancelled (Ctrl+C) is not an error
			if ctx.Err() != nil {
				break
			}
			return 2, nil, fmt.Errorf("reading WebSocket message: %w", err)
		}

		// Phase 31 (SC2): unwrap server-side batch envelope. Each frame from
		// the server may be either a flat per-event envelope (?nobatch=1 path
		// or pre-Phase-31 servers) or a batch wrapper carrying multiple inner
		// envelopes. UnwrapBatch handles both shapes; the inner loop below
		// dispatches each item identically to the original flat path.
		items, err := UnwrapBatch(data)
		if err != nil {
			continue // skip malformed outer frame
		}

		for _, item := range items {
			var msg JobMessage
			if err := json.Unmarshal(item, &msg); err != nil {
				continue // skip malformed inner envelope
			}

			switch msg.Type {
			case MsgLog:
				var d LogData
				// Phase 22 wsEnvelope renamed `data` → `payload`. Server still
				// writes `data` today; this carry-over is unchanged by Phase 31.
				if json.Unmarshal(msg.Data, &d) == nil {
					handler.HandleLog(d)
				}
			case MsgStep:
				var d StepData
				if json.Unmarshal(msg.Data, &d) == nil {
					handler.HandleStep(d)
				}
			case MsgStatus:
				var d StatusData
				if json.Unmarshal(msg.Data, &d) == nil {
					handler.HandleStatus(d)
					if IsTerminalStatus(d.Status) {
						finalStatus = d.Status
						goto done
					}
				}
			case MsgMetrics:
				var d MetricsData
				if json.Unmarshal(msg.Data, &d) == nil {
					handler.HandleMetrics(d)
				}
			}
		}
	}

done:
	// Close WebSocket gracefully
	conn.Close(websocket.StatusNormalClosure, "done")

	return exitCodeForStatus(finalStatus), nil, nil
}

func exitCodeForStatus(status string) int {
	switch status {
	case "passed":
		return 0
	case "failed":
		return 1
	case "cancelled", "timeout":
		return 2
	default:
		// Context cancelled or unknown
		return 2
	}
}
