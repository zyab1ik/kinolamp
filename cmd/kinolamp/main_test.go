package main

import "testing"

func TestMainReturnsConfigurationFailure(t *testing.T) {
	t.Setenv("CDN_HOSTS", "*")
	previous := exitProcess
	t.Cleanup(func() { exitProcess = previous })
	called := false
	exitProcess = func(code int) {
		called = true
		if code != 1 {
			t.Fatalf("invalid config must exit with 1, got %d", code)
		}
	}
	main()
	if !called {
		t.Fatal("entry point did not terminate with the application exit status")
	}
}
