package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// Small process boundary kept injectable so startup/shutdown paths can be tested.
var exitProcess = os.Exit

func main() { exitProcess(run(os.Getenv, os.Stderr, serveHTTP)) }

func run(getenv func(string) string, output io.Writer, serve func(*http.Server) error) int {
	c, err := loadConfig(getenv)
	if err != nil {
		_, _ = fmt.Fprintln(output, "Invalid configuration:", err)
		return 1
	}
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	client := newUpstreamClient(net.DefaultResolver.LookupNetIP, dialer.DialContext)
	address := getenv("LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:3000"
	}
	server := &http.Server{Addr: address, Handler: newApp(c, client), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 32768}
	if err := serve(server); err != nil && err != http.ErrServerClosed {
		_, _ = fmt.Fprintln(output, "HTTP server stopped")
		return 1
	}
	return 0
}

func serveHTTP(server *http.Server) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return serveWithContext(ctx, server)
}

func serveWithContext(ctx context.Context, server *http.Server) error {
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = server.Shutdown(shutdownCtx)
		case <-done:
		}
	}()
	err := server.ListenAndServe()
	close(done)
	return err
}
