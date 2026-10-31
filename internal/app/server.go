package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/zyab1ik/kinolamp/web"
)

type ticket struct {
	manifest string
	expires  time.Time
}
type rate struct {
	count int
	until time.Time
}

var publicAssets = map[string]struct{ name, contentType string }{
	"/":          {"static/index.html", "text/html; charset=utf-8"},
	"/kp":        {"static/kp.js", "application/javascript; charset=utf-8"},
	"/kp.js":     {"static/kp.js", "application/javascript; charset=utf-8"},
	"/style.css": {"static/style.css", "text/css; charset=utf-8"},
	"/icon.svg":  {"static/icon.svg", "image/svg+xml"},
}

type app struct {
	config  config
	client  *http.Client
	now     func() time.Time
	random  io.Reader
	mu      sync.Mutex
	tickets map[string]ticket
	rates   map[string]rate
	slots   chan struct{}
}

func newApp(c config, client *http.Client) *app {
	return &app{config: c, client: client, now: time.Now, random: rand.Reader, tickets: make(map[string]ticket), rates: make(map[string]rate), slots: make(chan struct{}, 4)}
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, code string) {
	respond(w, status, map[string]string{"error": code})
}

func (a *app) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'")
	origin := r.Header.Get("Origin")
	allowedOrigin := origin == ""
	for _, candidate := range a.config.origins {
		if origin == candidate {
			allowedOrigin = true
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
	}
	apiRoute := r.URL.Path == "/api/manifests" || strings.HasPrefix(r.URL.Path, "/hls/")
	if apiRoute && !allowedOrigin {
		fail(w, 403, "origin_forbidden")
		return
	}
	if r.Method == "OPTIONS" && r.URL.Path == "/api/manifests" {
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.WriteHeader(204)
		return
	}
	if file, ok := publicAssets[r.URL.Path]; ok && (r.Method == "GET" || r.Method == "HEAD") {
		body, _ := web.Files.ReadFile(file.name) // Embedded at compile time; names are constants.
		w.Header().Set("Content-Type", file.contentType)
		w.Header().Set("Access-Control-Allow-Origin", "*") // Only public, credential-free assets.
		w.WriteHeader(http.StatusOK)
		if r.Method == "GET" {
			_, _ = w.Write(body)
		}
		return
	}
	if r.Method == "GET" && r.URL.Path == "/health" {
		respond(w, 200, map[string]any{"ok": true, "version": Version, "proxy": a.config.proxy})
		return
	}
	if !a.config.proxy {
		fail(w, 404, "not_found")
		return
	}
	if r.Method == "POST" && r.URL.Path == "/api/manifests" && r.URL.RawQuery == "" {
		a.createTicket(w, r)
		return
	}
	if r.Method == "GET" && r.URL.RawQuery == "" && strings.HasPrefix(r.URL.Path, "/hls/") {
		id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/hls/"), ".m3u8")
		a.mu.Lock()
		value, ok := a.tickets[id]
		a.mu.Unlock()
		if ok && a.now().Before(value.expires) && r.URL.Path == "/hls/"+id+".m3u8" {
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = io.WriteString(w, value.manifest)
			return
		}
	}
	fail(w, 404, "not_found")
}

func (a *app) takeRate(ip string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	for key, value := range a.rates {
		if !now.Before(value.until) {
			delete(a.rates, key)
		}
	}
	value, exists := a.rates[ip]
	if !exists {
		if len(a.rates) >= 1024 {
			return false
		}
		value.until = now.Add(time.Minute)
	}
	value.count++
	a.rates[ip] = value
	return value.count <= 30
}

func (a *app) createTicket(w http.ResponseWriter, r *http.Request) {
	expected := sha256.Sum256([]byte("Bearer " + a.config.token))
	actual := sha256.Sum256([]byte(r.Header.Get("Authorization")))
	if subtle.ConstantTimeCompare(expected[:], actual[:]) != 1 {
		fail(w, 401, "unauthorized")
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if !a.takeRate(ip) {
		fail(w, 429, "busy")
		return
	}
	select {
	case a.slots <- struct{}{}:
		defer func() { <-a.slots }()
	default:
		fail(w, 429, "busy")
		return
	}
	var body struct {
		Master    string `json:"master"`
		Voice     int    `json:"voice"`
		MaxHeight int    `json:"maxHeight"`
	}
	body.MaxHeight = 1080
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 12288))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		fail(w, 400, "invalid_payload")
		return
	}
	if decoder.Decode(new(any)) != io.EOF || body.Voice < 0 || body.Voice > 99 || body.MaxHeight < 144 || body.MaxHeight > 4320 {
		fail(w, 400, "invalid_payload")
		return
	}
	target, err := allowedURL(body.Master, a.config.hosts)
	if err != nil {
		fail(w, 422, "manifest_unavailable")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	text, err := fetchMaster(ctx, a.client, target)
	if err != nil {
		fail(w, 422, "manifest_unavailable")
		return
	}
	manifest, err := reduceMaster(text, target, a.config.hosts, body.Voice, body.MaxHeight)
	if err != nil {
		fail(w, 422, "manifest_unavailable")
		return
	}
	var key [32]byte
	if _, err := io.ReadFull(a.random, key[:]); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	id, now := hex.EncodeToString(key[:]), a.now()
	a.mu.Lock()
	for key, value := range a.tickets {
		if !now.Before(value.expires) {
			delete(a.tickets, key)
		}
	}
	if len(a.tickets) >= 256 {
		for key := range a.tickets {
			delete(a.tickets, key)
			break
		}
	}
	a.tickets[id] = ticket{manifest, now.Add(5 * time.Minute)}
	a.mu.Unlock()
	respond(w, 201, map[string]any{"url": a.config.base + "/hls/" + id + ".m3u8", "expiresIn": 300})
}
