//go:build scrolithcore

package server

import (
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/ollama/ollama/types/model"
)

func TestScrolithCoreDisablesModelMutationAndFetchRoutes(t *testing.T) {
	handler, err := (&Server{addr: &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 8080}}).GenerateRoutes()
	if err != nil {
		t.Fatal(err)
	}
	requests := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/pull"},
		{http.MethodPost, "/api/push"},
		{http.MethodDelete, "/api/delete"},
		{http.MethodPost, "/api/create"},
		{http.MethodPost, "/api/blobs/sha256:deadbeef"},
		{http.MethodHead, "/api/blobs/sha256:deadbeef"},
		{http.MethodPost, "/api/copy"},
		{http.MethodPost, "/api/experimental/web_search"},
		{http.MethodPost, "/api/experimental/web_fetch"},
		{http.MethodGet, "/api/experimental/model-recommendations"},
		{http.MethodPost, "/api/codex/v1/responses"},
		{http.MethodGet, "/api/codex/_health"},
	}
	for _, tc := range requests {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader("{\"model\":\"untrusted/model\"}"))
			// Ollama's local-access middleware rejects httptest's default
			// example.com Host for a loopback listener before routing. Exercise
			// route omission through the host permitted for this private listener.
			req.RemoteAddr = "127.0.0.1:12345"
			req.Host = "localhost"
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, req)
			if recorder.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want 404", recorder.Code)
			}
		})
	}
}

func TestScrolithCoreDoesNotDownloadMissingModels(t *testing.T) {
	t.Setenv("OLLAMA_MODELS", t.TempDir())
	name := model.ParseName("qwen3:8b-not-installed")
	_, _, err := parseFromModel(t.Context(), name, nil)
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing model error = %v, want local not-exist error without download", err)
	}
}

func TestScrolithCoreBlocksCloudInferenceWithoutOutboundRequest(t *testing.T) {
	previousBaseURL := cloudProxyBaseURL
	called := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	cloudProxyBaseURL = upstream.URL
	t.Cleanup(func() { cloudProxyBaseURL = previousBaseURL })

	handler, err := (&Server{addr: &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 8080}}).GenerateRoutes()
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-oss:20b:cloud","messages":[{"role":"user","content":"test"}]}`))
	req.RemoteAddr = "127.0.0.1:12345"
	req.Host = "localhost"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", recorder.Code)
	}
	if called {
		t.Fatal("cloud inference attempted an outbound request in Scrolith Core mode")
	}
}
