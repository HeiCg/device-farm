package ipc

import (
	"context"
	"errors"
	"net"
	"os"
)

// Server is a Unix-domain-socket accept-one-client server. Mirrors the
// Phase 32 sim-capture-private IpcServer.mm pattern: bind, accept exactly
// one client, then close the listener so the caller can take over the conn.
type Server struct {
	socketPath string
	listener   net.Listener
}

// NewServer unlinks any stale socket at socketPath (the previous daemon may
// have crashed mid-stream) then binds a new one. The listener is NOT
// closed automatically — AcceptOne handles that on success/cancel.
func NewServer(socketPath string) (*Server, error) {
	_ = os.Remove(socketPath)
	ln, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, err
	}
	return &Server{socketPath: socketPath, listener: ln}, nil
}

// AcceptOne blocks until either a client connects (returning the net.Conn)
// or ctx is cancelled (returning ctx.Err and closing the listener).
func (s *Server) AcceptOne(ctx context.Context) (net.Conn, error) {
	type result struct {
		c   net.Conn
		err error
	}
	ch := make(chan result, 1)
	go func() {
		c, err := s.listener.Accept()
		ch <- result{c, err}
	}()
	select {
	case <-ctx.Done():
		_ = s.listener.Close()
		// Drain the pending Accept goroutine.
		go func() {
			if r := <-ch; r.c != nil {
				_ = r.c.Close()
			}
		}()
		return nil, ctx.Err()
	case r := <-ch:
		return r.c, r.err
	}
}

// Close closes the listener (if still open) and removes the socket file.
func (s *Server) Close() error {
	if s == nil || s.listener == nil {
		return nil
	}
	err := s.listener.Close()
	_ = os.Remove(s.socketPath)
	return err
}

// ErrShuttingDown is returned by handlers that observe ctx.Done mid-frame.
var ErrShuttingDown = errors.New("ipc: shutting down")
