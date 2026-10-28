package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
	"time"
)

const testMaster = `#EXTM3U
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="01. First",LANGUAGE="rus",DEFAULT=YES,URI="audio/first.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="02. Second",LANGUAGE="eng",URI="audio/second.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",URI="subs.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=3840x2160,CODECS="hvc1.1,mp4a.40.2",FRAME-RATE=24,AUDIO="a"
4k.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,AUDIO="a"
1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,AUDIO="a"
720.m3u8
`

func require(t *testing.T, ok bool, message string) {
	t.Helper()
	if !ok {
		t.Fatal(message)
	}
}
func parsed(raw string) *url.URL {
	u, err := url.Parse(raw)
	if err != nil {
		panic(err)
	}
	return u
}
func testConfig() config {
	return config{proxy: true, token: strings.Repeat("x", 64), hosts: []string{".cdn.example"}, origins: []string{"https://lampa.example"}, base: "https://plugin.example"}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func upstream(status int, body string) *http.Client {
	return &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "" {
			panic("OAuth or proxy key forwarded upstream")
		}
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
}

type errorReader struct{}

func (errorReader) Read([]byte) (int, error) { return 0, errors.New("read failed") }

func TestAddressPolicy(t *testing.T) {
	for _, address := range []string{"", "127.0.0.2", "10.1.2.3", "192.168.1.1", "100.64.1.1", "169.254.169.254", "::1", "fd00::1", "fe80::1", "::ffff:8.8.8.8", "2001:db8::1", "2002:7f00:1::", "3fff::1", "2001:4860::1%eth0"} {
		ip, _ := netip.ParseAddr(address)
		require(t, !publicIP(ip), "unsafe address accepted: "+address)
	}
	for _, address := range []string{"8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"} {
		require(t, publicIP(netip.MustParseAddr(address)), "public address rejected")
	}
	hosts, err := parseHosts(" , .CDN.EXAMPLE,edge.other.example ")
	require(t, err == nil && len(hosts) == 2, "allowlist parsing failed")
	for _, value := range []string{"*", ".com", "127.0.0.1", "https://cdn.example", "a..example"} {
		_, err := parseHosts(value)
		require(t, err != nil, "bad allowlist accepted")
	}
	for _, raw := range []string{"http://cdn.example/master", "https://127.0.0.2/", "https://[::1]/", "https://user:pass@cdn.example/", "https://cdn.example:444/", "https://evilcdn.example/", "https://cdn.example.evil.test/", "https://cdn.example/#frag", "https://%xx/", strings.Repeat("x", 8193)} {
		_, err := allowedURL(raw, hosts)
		require(t, err != nil, "unsafe URL accepted: "+raw[:min(len(raw), 80)])
	}
	for _, raw := range []string{"https://cdn.example/master", "https://edge.cdn.example:443/master?sig=secret", "https://edge.other.example/master"} {
		_, err := allowedURL(raw, hosts)
		require(t, err == nil, "trusted URL rejected")
	}
}

func TestPinnedDial(t *testing.T) {
	lookup := func(_ context.Context, _, host string) ([]netip.Addr, error) {
		require(t, host == "edge.cdn.example", "lookup host mismatch")
		return []netip.Addr{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("1.1.1.1")}, nil
	}
	calls := 0
	var peer net.Conn
	dial := func(_ context.Context, _, address string) (net.Conn, error) {
		calls++
		if calls == 1 {
			require(t, address == "8.8.8.8:443", "first address not pinned")
			return nil, errors.New("unreachable")
		}
		require(t, address == "1.1.1.1:443", "fallback not pinned")
		conn, other := net.Pipe()
		peer = other
		return conn, nil
	}
	client := newUpstreamClient(lookup, dial)
	transport := client.Transport.(*http.Transport)
	conn, err := transport.DialContext(context.Background(), "tcp", "edge.cdn.example:443")
	require(t, err == nil && calls == 2 && transport.Proxy == nil && transport.TLSClientConfig.MinVersion != 0, "unsafe transport")
	conn.Close()
	peer.Close()
	require(t, client.CheckRedirect(nil, nil) == http.ErrUseLastResponse, "redirects must be rejected")
	_, err = safeDial(context.Background(), "tcp", "bad address", lookup, dial)
	require(t, err != nil, "bad socket address accepted")
	for _, mode := range []string{"error", "empty", "private", "mixed", "dialerror"} {
		resolver := func(context.Context, string, string) ([]netip.Addr, error) {
			switch mode {
			case "error":
				return nil, errors.New("DNS failed")
			case "empty":
				return nil, nil
			case "private":
				return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
			case "mixed":
				return []netip.Addr{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("10.0.0.1")}, nil
			default:
				return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
			}
		}
		_, err := safeDial(context.Background(), "tcp", "edge.cdn.example:443", resolver, func(context.Context, string, string) (net.Conn, error) { return nil, errors.New("connect failed") })
		require(t, err != nil, "failure was swallowed: "+mode)
	}
}

func TestUpstreamBoundaries(t *testing.T) {
	target := parsed("https://edge.cdn.example/master.m3u8")
	text, err := fetchMaster(context.Background(), upstream(200, testMaster), target)
	require(t, err == nil && text == testMaster, "upstream content mismatch")
	for _, status := range []int{302, 403, 500} {
		_, err := fetchMaster(context.Background(), upstream(status, ""), target)
		require(t, err != nil, "upstream status accepted")
	}
	_, err = fetchMaster(context.Background(), upstream(200, strings.Repeat("x", 1024*1024+1)), target)
	require(t, err != nil, "oversized upstream accepted")
	failed := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("network failed") })}
	_, err = fetchMaster(context.Background(), failed, target)
	require(t, err != nil, "transport failure swallowed")
	readerFailed := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(errorReader{})}, nil
	})}
	_, err = fetchMaster(context.Background(), readerFailed, target)
	require(t, err != nil, "read failure swallowed")
	_, err = fetchMaster(context.Background(), failed, &url.URL{Scheme: "https", Host: "\x7f"})
	require(t, err != nil, "invalid request target accepted")
}

func TestHLSSelectionAndInjection(t *testing.T) {
	base, hosts := parsed("https://edge.cdn.example/path/master.m3u8"), testConfig().hosts
	text, err := reduceMaster(testMaster, base, hosts, 2, 1080)
	require(t, err == nil && strings.Contains(text, "/path/1080.m3u8") && strings.Contains(text, "/audio/second.m3u8") && !strings.Contains(text, "First") && !strings.Contains(text, "SUBTITLES"), "wrong track or quality")
	text, err = reduceMaster(testMaster, base, hosts, 0, 2160)
	require(t, err == nil && strings.Contains(text, "hvc1.1,mp4a.40.2") && strings.Contains(text, "FRAME-RATE=24") && strings.Contains(text, "first.m3u8"), "master attributes lost")
	text, err = reduceMaster(testMaster, base, hosts, 1, 480)
	require(t, err == nil && strings.Contains(text, "720.m3u8"), "minimum quality fallback failed")
	fallback := strings.ReplaceAll(strings.ReplaceAll(testMaster, "01. First", "First"), "02. Second", "Second")
	fallback = strings.ReplaceAll(fallback, "LANGUAGE=\"eng\"", "LANGUAGE=\"bad<>\"")
	text, err = reduceMaster(fallback, base, hosts, 2, 1080)
	require(t, err == nil && strings.Contains(text, "LANGUAGE=\"und\"") && strings.Contains(text, "second.m3u8"), "audio index fallback failed")
	simple := "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=10\nvideo.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=20\nother.m3u8\n"
	text, err = reduceMaster(simple, base, hosts, 0, 1080)
	require(t, err == nil && strings.Contains(text, "video.m3u8"), "video-only master failed")
	_, err = reduceMaster(testMaster+"#EXT-X-STREAM-INF:BANDWIDTH=1\n", base, hosts, 99, 1080)
	require(t, err != nil, "missing audio accepted")
	for _, input := range []string{"bad", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=bad\nvideo", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n#BAD", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n", strings.ReplaceAll(testMaster, "URI=\"audio/first.m3u8\"", "URI=\"\""), strings.ReplaceAll(testMaster, "audio/first.m3u8", "https://evil.example/a"), strings.ReplaceAll(testMaster, "audio/first.m3u8", "%xx"), strings.ReplaceAll(simple, "video.m3u8", "https://127.0.0.1/a")} {
		_, err := reduceMaster(input, base, hosts, 0, 1080)
		require(t, err != nil, "unsafe HLS accepted")
	}
}

func TestConfigAndRuntime(t *testing.T) {
	get := func(values map[string]string) func(string) string {
		return func(key string) string { return values[key] }
	}
	valid := map[string]string{"ENABLE_PROXY": "true", "PROXY_TOKEN": strings.Repeat("x", 32), "CDN_HOSTS": ".cdn.example", "PUBLIC_BASE_URL": "https://plugin.example", "ALLOWED_ORIGINS": " https://lampa.example,null, "}
	c, err := loadConfig(get(valid))
	require(t, err == nil && c.proxy && len(c.origins) == 2, "valid config rejected")
	for _, pair := range [][2]string{{"CDN_HOSTS", "*"}, {"ALLOWED_ORIGINS", "*"}, {"ALLOWED_ORIGINS", "https://a.example/path"}, {"PROXY_TOKEN", "short"}, {"PUBLIC_BASE_URL", "http://a.example"}, {"PUBLIC_BASE_URL", "https://a.example/"}, {"PUBLIC_BASE_URL", "https://user:pass@a.example"}} {
		copy := make(map[string]string)
		for key, value := range valid {
			copy[key] = value
		}
		copy[pair[0]] = pair[1]
		_, err := loadConfig(get(copy))
		require(t, err != nil, "invalid config accepted")
	}
	var output bytes.Buffer
	require(t, Run(get(map[string]string{"CDN_HOSTS": "*"}), &output, nil) == 1, "invalid startup must fail")
	require(t, Run(get(nil), &output, func(server *http.Server) error {
		require(t, server.Addr == "127.0.0.1:3000" && server.ReadTimeout > 0, "default bind/timeout wrong")
		return http.ErrServerClosed
	}) == 0, "normal shutdown must succeed")
	require(t, Run(get(map[string]string{"LISTEN_ADDR": "localhost:9999"}), &output, func(server *http.Server) error {
		require(t, server.Addr == "localhost:9999", "custom bind ignored")
		return errors.New("sensitive underlying error")
	}) == 1 && !strings.Contains(output.String(), "sensitive"), "startup errors leak details")
	require(t, Run(get(nil), &output, func(*http.Server) error { return nil }) == 0, "nil result failed")
	require(t, ServeHTTP(&http.Server{Addr: "invalid address"}) != nil, "listen failure lost")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	require(t, serveWithContext(ctx, &http.Server{Addr: "127.0.0.1:0"}) == http.ErrServerClosed, "context shutdown failed")
}

func call(a *app, method, path, body, token, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:1234"
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	return w
}

const validBody = `{"master":"https://edge.cdn.example/master.m3u8?secret=hidden","voice":2,"maxHeight":1080}`

func TestHTTPPrivacyAndTickets(t *testing.T) {
	c := testConfig()
	a := newApp(c, upstream(200, testMaster))
	now := time.Now()
	a.now = func() time.Time { return now }
	for _, path := range []string{"/", "/kp.js?version=1", "/health"} {
		w := call(a, "GET", path, "", "", "")
		require(t, w.Code == 200 && w.Header().Get("Cache-Control") == "no-store", "static route failed")
	}
	require(t, call(a, "POST", "/api/manifests", validBody, "", "").Code == 401, "API not protected")
	require(t, call(a, "POST", "/api/manifests", validBody, c.token, "https://evil.example").Code == 403, "CORS origin not enforced")
	w := call(a, "OPTIONS", "/api/manifests", "", "", c.origins[0])
	require(t, w.Code == 204 && w.Header().Get("Access-Control-Allow-Origin") == c.origins[0], "preflight failed")
	w = call(a, "POST", "/api/manifests", validBody, c.token, c.origins[0])
	require(t, w.Code == 201 && !strings.Contains(w.Body.String(), "hidden") && !strings.Contains(w.Body.String(), c.token), "ticket leaks a secret")
	var response struct {
		URL string `json:"url"`
	}
	require(t, jsonDecode(w.Body.String(), &response) == nil, "bad JSON")
	path := strings.TrimPrefix(response.URL, c.base)
	w = call(a, "GET", path, "", "", "")
	require(t, w.Code == 200 && strings.Contains(w.Body.String(), "second.m3u8"), "ticket did not serve reduced HLS")
	require(t, call(a, "GET", path+"?token=oops", "", "", "").Code == 404, "query credentials accepted")
	now = now.Add(6 * time.Minute)
	require(t, call(a, "GET", path, "", "", "").Code == 404, "expired ticket accepted")
	for i := 0; i < 256; i++ {
		a.tickets[string(rune(i))] = ticket{"x", now.Add(time.Hour)}
	}
	a.tickets["expired"] = ticket{"x", now.Add(-time.Second)}
	require(t, call(a, "POST", "/api/manifests", validBody, c.token, "").Code == 201 && len(a.tickets) == 256, "bounded ticket store failed")
	for _, path := range []string{"/missing", "/hls/unknown.m3u8", "/hls/expired.m3u8", "/api/manifests?token=oops"} {
		require(t, call(a, "GET", path, "", "", "").Code == 404, "unknown route accepted")
	}
	disabled := newApp(config{}, nil)
	require(t, call(disabled, "POST", "/api/manifests", validBody, c.token, "").Code == 404, "proxy enabled by default")
}

func TestHTTPFailuresAndLimits(t *testing.T) {
	c := testConfig()
	for _, body := range []string{"bad", "[]", `{"unexpected":true}`, `{}`, validBody + " {}", strings.Repeat("x", 12289), strings.ReplaceAll(validBody, `"voice":2`, `"voice":100`), strings.ReplaceAll(validBody, `"maxHeight":1080`, `"maxHeight":1`)} {
		a := newApp(c, upstream(200, testMaster))
		w := call(a, "POST", "/api/manifests", body, c.token, "")
		require(t, w.Code == 400 || w.Code == 422, "bad request accepted")
	}
	a := newApp(c, upstream(500, ""))
	require(t, call(a, "POST", "/api/manifests", validBody, c.token, "").Code == 422, "upstream failure lost")
	a = newApp(c, upstream(200, "bad HLS"))
	require(t, call(a, "POST", "/api/manifests", validBody, c.token, "").Code == 422, "bad manifest accepted")
	a = newApp(c, upstream(200, testMaster))
	a.random = errorReader{}
	require(t, call(a, "POST", "/api/manifests", validBody, c.token, "").Code == 503, "random source failure ignored")
	a = newApp(c, upstream(200, testMaster))
	for i := 0; i < 4; i++ {
		a.slots <- struct{}{}
	}
	require(t, call(a, "POST", "/api/manifests", validBody, c.token, "").Code == 429, "concurrency limit ignored")
	a = newApp(c, upstream(200, testMaster))
	for i := 0; i < 30; i++ {
		require(t, a.takeRate("127.0.0.1"), "rate blocked early")
	}
	require(t, call(a, "POST", "/api/manifests", validBody, c.token, "").Code == 429, "rate limit ignored")
	a.rates = make(map[string]rate)
	for i := 0; i < 1024; i++ {
		a.rates[string(rune(i))] = rate{1, time.Now().Add(time.Hour)}
	}
	require(t, !a.takeRate("new"), "unbounded IP map")
}

func jsonDecode(body string, into any) error {
	return json.NewDecoder(strings.NewReader(body)).Decode(into)
}
