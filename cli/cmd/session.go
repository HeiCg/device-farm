package cmd

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/device-farm/cli/internal/session"
)

// sessionCmd is the parent command for interactive device sessions. Subcommands
// (lease, tap, type, swipe, key, screenshot, release) shell HTTP/WS calls
// against the server through cli/internal/session.
var sessionCmd = &cobra.Command{
	Use:   "session",
	Short: "Interactive device sessions (lease, tap, type, screenshot, release)",
	Long: `Interactive device sessions.

A session is a leased device that accepts real-time action envelopes
(tap, type, swipe, key, screenshot) over a WebSocket. The lease handshake
returns a server-authoritative WebSocket URL which the CLI persists at
~/.device-farm/session.json so subsequent shell invocations can re-use the
lease without re-authenticating.

Typical flow:
  device-farm session lease --platform android --ttl 600
  device-farm session tap --x 540 --y 960
  device-farm session screenshot -o cur.png
  device-farm session release

Session resolution precedence: --session-id flag > $DEVICE_FARM_SESSION_ID > persist file.`,
	Args: cobra.NoArgs,
}

func init() {
	sessionCmd.PersistentFlags().String("session-id", "", "override persisted session id")
	sessionCmd.AddCommand(
		sessionLeaseCmd,
		sessionTapCmd,
		sessionTypeCmd,
		sessionSwipeCmd,
		sessionKeyCmd,
		sessionScreenshotCmd,
		sessionReleaseCmd,
	)
	rootCmd.AddCommand(sessionCmd)
}

// resolveSession applies precedence flag > env > persist file to locate the
// active session reference. Returns a sentinel error when no source surfaces a
// session id so callers can format a clear "no active session" message.
//
// When --session-id is provided but no persist file exists, a synthetic Ref is
// returned with the wsUrl/token fields populated from the persist file lookup
// if any matches; otherwise the caller is expected to fail because actions
// require wsUrl + token which only the lease response carries.
func resolveSession(cmd *cobra.Command) (*session.Ref, error) {
	// Persist file is the source of truth for wsUrl + token. The flag/env
	// inputs only override the sessionId — they don't materialize the wsUrl.
	// In practice the user runs `session lease` (which persists), then
	// subsequent commands resolve from the persist file. The --session-id
	// flag is for the rare case where two terminals share a lease.
	flagID, _ := cmd.Flags().GetString("session-id")
	envID := os.Getenv("DEVICE_FARM_SESSION_ID")

	ref, err := session.Load()
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("load persisted session: %w", err)
	}

	override := flagID
	if override == "" {
		override = envID
	}

	if override != "" {
		if ref == nil {
			return nil, fmt.Errorf("--session-id (or $DEVICE_FARM_SESSION_ID) provided but no persisted session file — run `device-farm session lease` first to materialize wsUrl/token, or set DEVICE_FARM_URL+DEVICE_FARM_API_KEY to override")
		}
		// Honor override: re-use wsUrl/token but rewrite the sessionId path
		// segment. The wsUrl format is .../ws/sessions/{sessionId}?token=X —
		// the server resolves the session from the URL path param.
		if override != ref.SessionID {
			rewritten := strings.Replace(ref.WSUrl, "/ws/sessions/"+ref.SessionID, "/ws/sessions/"+override, 1)
			return &session.Ref{
				SessionID:  override,
				WSUrl:      rewritten,
				Token:      ref.Token,
				DeviceID:   ref.DeviceID,
				DeviceName: ref.DeviceName,
				Platform:   ref.Platform,
				LeaseUntil: ref.LeaseUntil,
			}, nil
		}
	}

	if ref == nil {
		return nil, errors.New("no active session — run `device-farm session lease` first")
	}
	// Auto-drop expired persist (lease passed): force re-lease rather than
	// hang on a server "session_not_found" later.
	if !ref.LeaseUntil.IsZero() && ref.LeaseUntil.Before(timeNow()) {
		return nil, fmt.Errorf("persisted session %s expired at %s — run `device-farm session lease` to refresh", ref.SessionID, ref.LeaseUntil.Format(time.RFC3339))
	}
	return ref, nil
}

// timeNow indirection lets tests freeze the clock.
var timeNow = func() time.Time { return time.Now() }
