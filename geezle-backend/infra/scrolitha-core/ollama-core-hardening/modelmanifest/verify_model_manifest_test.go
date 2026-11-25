package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

func fixtureManifest(modelDigest string) []byte {
	manifest := modelManifest{
		SchemaVersion: 2,
		MediaType:     dockerManifestMediaType,
		Config: manifestLayer{
			MediaType: "application/vnd.docker.container.image.v1+json",
			Digest:    "sha256:" + strings.Repeat("1", 64),
			Size:      487,
		},
		Layers: []manifestLayer{
			{MediaType: ollamaModelLayerMediaType, Digest: "sha256:" + modelDigest, Size: 1024},
			{MediaType: "application/vnd.ollama.image.template", Digest: "sha256:" + strings.Repeat("2", 64), Size: 32},
		},
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		panic(err)
	}
	return data
}

func digestOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func TestPinnedModelManifestAcceptsExactAndEquivalentJSON(t *testing.T) {
	pinned := fixtureManifest(strings.Repeat("a", 64))
	installed := []byte("\n " + string(pinned) + " \n")
	if err := validatePinnedModelManifest(pinned, installed, digestOf(pinned)); err != nil {
		t.Fatalf("equivalent installed manifest rejected: %v", err)
	}
}

func TestPinnedModelManifestRejectsChangedModelLayer(t *testing.T) {
	pinned := fixtureManifest(strings.Repeat("a", 64))
	installed := fixtureManifest(strings.Repeat("b", 64))
	if err := validatePinnedModelManifest(pinned, installed, digestOf(pinned)); err == nil {
		t.Fatal("changed model layer digest was accepted")
	}
}

func TestPinnedModelManifestRejectsChangedConfigAndLayerSize(t *testing.T) {
	pinned := fixtureManifest(strings.Repeat("a", 64))
	var changed modelManifest
	if err := json.Unmarshal(pinned, &changed); err != nil {
		t.Fatal(err)
	}
	changed.Config.Digest = "sha256:" + strings.Repeat("3", 64)
	changed.Layers[0].Size++
	installed, err := json.Marshal(changed)
	if err != nil {
		t.Fatal(err)
	}
	if err := validatePinnedModelManifest(pinned, installed, digestOf(pinned)); err == nil {
		t.Fatal("changed config or layer size was accepted")
	}
}

func TestPinnedModelManifestRejectsTamperedPinAndUnknownFields(t *testing.T) {
	pinned := fixtureManifest(strings.Repeat("a", 64))
	if err := validatePinnedModelManifest(append(pinned, ' '), pinned, digestOf(pinned)); err == nil {
		t.Fatal("tampered pinned manifest was accepted")
	}
	unknown := append([]byte(nil), pinned...)
	unknown = append(unknown[:len(unknown)-1], []byte(`,"unexpected":true}`)...)
	if err := validatePinnedModelManifest(unknown, unknown, digestOf(unknown)); err == nil {
		t.Fatal("unknown manifest fields were accepted")
	}
}
