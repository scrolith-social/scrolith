//go:build scrolithcore

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/ollama/ollama/cmd"
)

const coreModel = "qwen3:8b"
const coreModelManifestDigest = "sha256:500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--healthcheck" {
		if err := checkCoreModelTags(nil, "http://127.0.0.1:8080/api/tags", coreModel, coreModelManifestDigest); err != nil {
			fmt.Fprintln(os.Stderr, "Scrolith Core health check failed: bundled model is unavailable or does not match the pinned manifest.")
			os.Exit(1)
		}
		return
	}
	if err := cmd.RunServer(nil, nil); err != nil {
		fmt.Fprintln(os.Stderr, "Scrolith Core server failed.")
		os.Exit(1)
	}
}

func checkCoreModelTags(client *http.Client, endpoint, modelName, digest string) error {
	if modelName != coreModel || digest != coreModelManifestDigest {
		return errors.New("unexpected model identity")
	}
	var transport http.RoundTripper = http.DefaultTransport
	if client != nil && client.Transport != nil {
		transport = client.Transport
	}
	client = &http.Client{
		Transport: transport,
		Timeout:   2 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Get(endpoint)
	if err != nil {
		return errors.New("local Ollama tags endpoint unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return errors.New("local Ollama tags endpoint not ready")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(body) > 1<<20 {
		return errors.New("invalid local Ollama tags response")
	}
	var tags struct {
		Models []struct {
			Name   string `json:"name"`
			Digest string `json:"digest"`
		} `json:"models"`
	}
	if err := json.Unmarshal(body, &tags); err != nil {
		return errors.New("invalid local Ollama tags response")
	}
	for _, model := range tags.Models {
		if model.Name == modelName && model.Digest == digest {
			return nil
		}
	}
	return errors.New("pinned model is missing")
}
