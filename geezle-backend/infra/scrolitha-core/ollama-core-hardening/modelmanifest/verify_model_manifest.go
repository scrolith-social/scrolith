package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"regexp"
)

const qwen3ManifestSHA256 = "500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41"
const dockerManifestMediaType = "application/vnd.docker.distribution.manifest.v2+json"
const ollamaModelLayerMediaType = "application/vnd.ollama.image.model"

var sha256DigestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

type manifestLayer struct {
	MediaType string `json:"mediaType"`
	Digest    string `json:"digest"`
	Size      int64  `json:"size"`
	From      string `json:"from,omitempty"`
	Name      string `json:"name,omitempty"`
}

type modelManifest struct {
	SchemaVersion int             `json:"schemaVersion"`
	MediaType     string          `json:"mediaType"`
	Config        manifestLayer   `json:"config"`
	Layers        []manifestLayer `json:"layers"`
	Runner        string          `json:"runner,omitempty"`
	Format        string          `json:"format,omitempty"`
	Manifests     []modelManifest `json:"manifests,omitempty"`
}

func decodeManifest(data []byte) (modelManifest, error) {
	var parsed modelManifest
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&parsed); err != nil {
		return modelManifest{}, fmt.Errorf("decode model manifest: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return modelManifest{}, errors.New("model manifest has trailing JSON data")
		}
		return modelManifest{}, fmt.Errorf("read model manifest end: %w", err)
	}
	return parsed, nil
}

func validateManifestShape(manifest modelManifest) error {
	if manifest.SchemaVersion != 2 || manifest.MediaType != dockerManifestMediaType || len(manifest.Manifests) != 0 {
		return errors.New("expected a single schema-v2 Ollama model manifest")
	}
	if manifest.Config.MediaType != "application/vnd.docker.container.image.v1+json" ||
		!sha256DigestPattern.MatchString(manifest.Config.Digest) || manifest.Config.Size <= 0 {
		return errors.New("model manifest has an invalid config descriptor")
	}
	if len(manifest.Layers) == 0 {
		return errors.New("model manifest has no layers")
	}
	hasModelLayer := false
	for _, layer := range manifest.Layers {
		if layer.MediaType == "" || !sha256DigestPattern.MatchString(layer.Digest) || layer.Size <= 0 {
			return errors.New("model manifest has an invalid layer descriptor")
		}
		if layer.MediaType == ollamaModelLayerMediaType {
			hasModelLayer = true
		}
	}
	if !hasModelLayer {
		return errors.New("model manifest does not contain an Ollama model layer")
	}
	return nil
}

func validatePinnedModelManifest(pinnedData, installedData []byte, expectedSHA256 string) error {
	if len(expectedSHA256) != sha256.Size*2 {
		return errors.New("expected model manifest SHA-256 is invalid")
	}
	if _, err := hex.DecodeString(expectedSHA256); err != nil {
		return errors.New("expected model manifest SHA-256 is invalid")
	}
	pinnedHash := sha256.Sum256(pinnedData)
	if hex.EncodeToString(pinnedHash[:]) != expectedSHA256 {
		return errors.New("pinned model manifest does not match its reviewed SHA-256")
	}

	pinned, err := decodeManifest(pinnedData)
	if err != nil {
		return fmt.Errorf("validate pinned model manifest: %w", err)
	}
	installed, err := decodeManifest(installedData)
	if err != nil {
		return fmt.Errorf("validate installed model manifest: %w", err)
	}
	if err := validateManifestShape(pinned); err != nil {
		return fmt.Errorf("invalid pinned model manifest: %w", err)
	}
	if err := validateManifestShape(installed); err != nil {
		return fmt.Errorf("invalid installed model manifest: %w", err)
	}
	if !reflect.DeepEqual(pinned, installed) {
		return errors.New("installed model config or layer descriptors differ from the pinned manifest")
	}
	return nil
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: verify_model_manifest <pinned-manifest.json> <installed-manifest.json>")
		os.Exit(2)
	}
	pinnedData, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot read pinned model manifest")
		os.Exit(2)
	}
	installedData, err := os.ReadFile(os.Args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot read installed model manifest")
		os.Exit(2)
	}
	if err := validatePinnedModelManifest(pinnedData, installedData, qwen3ManifestSHA256); err != nil {
		fmt.Fprintf(os.Stderr, "Qwen3 model bundle failed pinned manifest verification: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Qwen3 model manifest verified against pinned SHA-256 %s and all config/layer descriptors.\n", qwen3ManifestSHA256)
}
