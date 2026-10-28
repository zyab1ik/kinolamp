// Command kinolamp serves the Lampa plugin and optional authenticated HLS proxy.
package main

import (
	"os"

	"github.com/zyab1ik/kinolamp/internal/app"
)

// Keep the process boundary replaceable for testing the real entry point.
var exitProcess = os.Exit

func main() { exitProcess(app.Run(os.Getenv, os.Stderr, app.ServeHTTP)) }
