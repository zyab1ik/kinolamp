// Package web contains the static assets embedded into the Kinolamp binary.
package web

import "embed"

// Files provides the plugin and installation page, without a runtime filesystem dependency.
//
//go:embed static/kp.js static/index.html static/icon.svg
var Files embed.FS
