package session

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"nhooyr.io/websocket"
)

// actionTimeout is the upper bound on how long SendAction waits for a matching
// ack/error frame. Exported as a package var so tests can override (the WS
// upgrade itself takes a few ms; a 30s budget gives slow actions like
// screenRecord room to complete).
var actionTimeout = 30 * time.Second

// LeaseRequest is the POST /api/sessions body shape. Fields mirror the Zod
// schema landed in server/sessions/schemas.ts (Plan 34-00).
type LeaseRequest struct {
	Platform    string         `json:"platform"`
	TTLSeconds  int            `json:"ttlSeconds,omitempty"`
	DeviceQuery map[string]any `json:"deviceQuery,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// Lease POSTs a lease request and returns the persisted Ref. The Bearer token
// is threaded onto the returned Ref so subsequent SendAction calls can
// re-authenticate via the wsUrl's embedded ?token= query param.
func Lease(serverURL, token string, body LeaseRequest) (*Ref, error) {
	buf, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal lease body: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, serverURL+"/api/sessions", bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("lease failed %d: %s", resp.StatusCode, string(b))
	}

	var ref Ref
	if err := json.NewDecoder(resp.Body).Decode(&ref); err != nil {
		return nil, fmt.Errorf("decode lease response: %w", err)
	}
	// Token is not returned in the lease body (server-side; client owns it).
	// Persist it on the Ref so subsequent commands can re-authenticate.
	ref.Token = token
	return &ref, nil
}

// Release DELETEs the given session id. 4xx/5xx responses surface as errors so
// the CLI can exit non-zero (and skip the persist-file Clear).
func Release(serverURL, token, sessionID string) error {
	req, err := http.NewRequest(http.MethodDelete, serverURL+"/api/sessions/"+sessionID, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("release failed %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

// newMsgID returns a UUID v4 string. Server schema (server/sessions/internal/
// protocol.ts) validates `z.string().uuid()`; a bare 32-char hex string is
// rejected with `invalid_envelope`.
func newMsgID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	// RFC 4122 v4 bits: version = 4, variant = 10xx.
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	), nil
}

// SendAction dials the wsURL, writes the envelope, and waits for an ack or
// error frame whose forMsgId matches the envelope's id. Returns the ack frame
// as a map on success, or an error from a server error frame / timeout /
// network failure.
//
// The envelope is expected to be a JSON-serializable map. If it lacks an "id",
// one is generated. The function blocks until ack arrives or actionTimeout
// fires.
func SendAction(wsURL, token string, envelope map[string]any) (map[string]any, error) {
	if _, ok := envelope["id"]; !ok {
		id, err := newMsgID()
		if err != nil {
			return nil, fmt.Errorf("generate msg id: %w", err)
		}
		envelope["id"] = id
	}
	wantID, ok := envelope["id"].(string)
	if !ok {
		return nil, fmt.Errorf("envelope id must be a string, got %T", envelope["id"])
	}

	ctx, cancel := context.WithTimeout(context.Background(), actionTimeout)
	defer cancel()

	header := http.Header{}
	header.Set("Authorization", "Bearer "+token)

	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: header,
	})
	if err != nil {
		return nil, fmt.Errorf("ws dial: %w", err)
	}
	defer conn.CloseNow()

	conn.SetReadLimit(1 << 20) // 1 MiB — screenshots & hierarchies can be large

	buf, err := json.Marshal(envelope)
	if err != nil {
		return nil, fmt.Errorf("marshal envelope: %w", err)
	}
	if err := conn.Write(ctx, websocket.MessageText, buf); err != nil {
		return nil, fmt.Errorf("ws write: %w", err)
	}

	// Read loop — keep reading until we see a frame whose forMsgId matches
	// our envelope id. Non-matching frames are discarded (other actions might
	// be in flight on the same session in pathological cases, though the CLI
	// uses one envelope per dial).
	for {
		_, raw, err := conn.Read(ctx)
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return nil, errors.New("action timeout")
			}
			return nil, fmt.Errorf("ws read: %w", err)
		}
		var frame map[string]any
		if err := json.Unmarshal(raw, &frame); err != nil {
			continue
		}
		forMsgID, _ := frame["forMsgId"].(string)
		if forMsgID != wantID {
			continue
		}
		switch frame["type"] {
		case "ack", "pong":
			return frame, nil
		case "error":
			code, _ := frame["code"].(string)
			msg, _ := frame["message"].(string)
			if code == "" {
				code = "ws_error"
			}
			return nil, fmt.Errorf("%s: %s", code, msg)
		default:
			// Unknown matching frame type — ignore and keep reading.
		}
	}
}
