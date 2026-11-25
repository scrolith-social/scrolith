//go:build scrolithcore

package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

const validTags = `{"models":[{"name":"qwen3:8b","digest":"sha256:500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41"}]}`

func TestScrolithCoreHealthRequiresPinnedBundledModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(validTags))
	}))
	defer server.Close()
	if err := checkCoreModelTags(server.Client(), server.URL, coreModel, coreModelManifestDigest); err != nil {
		t.Fatalf("valid pinned model rejected: %v", err)
	}
}

func TestScrolithCoreHealthRejectsMutableOrUnexpectedModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"models":[{"name":"qwen3:8b","digest":"sha256:deadbeef"}]}`))
	}))
	defer server.Close()
	if err := checkCoreModelTags(server.Client(), server.URL, coreModel, coreModelManifestDigest); err == nil {
		t.Fatal("unexpected model digest was accepted")
	}
	if err := checkCoreModelTags(server.Client(), server.URL, "qwen3:14b", coreModelManifestDigest); err == nil {
		t.Fatal("unsupported model name was accepted")
	}
}
