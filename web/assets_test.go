package web

import (
	"bytes"
	"testing"
)

func TestEmbeddedAssets(t *testing.T) {
	for _, name := range []string{"static/kp.js", "static/index.html"} {
		body, err := Files.ReadFile(name)
		if err != nil || !bytes.Contains(body, []byte("Kinolamp")) {
			t.Fatalf("missing or outdated embedded asset %s: %v", name, err)
		}
	}
	if _, err := Files.ReadFile("../configs/kinolamp.env.example"); err == nil {
		t.Fatal("configuration must not be embedded or exposed as a web asset")
	}
}
