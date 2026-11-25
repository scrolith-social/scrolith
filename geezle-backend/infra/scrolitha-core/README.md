# Scrolith Core image

This image is a private inference-only Ollama appliance. From the repository root, build with the Core directory as the context (the Dockerfile copies `ollama-core-hardening.patch`, `ollama-core-hardening/`, and the bundled model manifest from that directory):

```powershell
docker build --pull --no-cache --progress=plain --target runtime `
  --build-arg ACR_BUILD_NONCE=<unique-run-id> `
  --tag scrolith-core-runtime:<local-tag> `
  .\geezle-backend\infra\scrolitha-core
```

The build fetches the pinned Ollama v0.40.17 commit, applies `ollama-core-hardening.patch`, copies the build-tagged Core sources, and runs focused route/CLI/missing-model tests before producing the binary.

The Core binary does not expose model pull, push, create, delete, blob upload, copy, web-search, web-fetch, or model-recommendation routes. A model absent from the image returns a not-found error instead of triggering a registry pull. The runtime does not contain or expose Ollama's management CLI; it starts the server directly and offers only an internal healthcheck mode.

The build pulls `qwen3:8b` in a separate pinned upstream-image stage and verifies the SHA-256 of the raw Ollama manifest against `500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`. A registry tag change therefore fails the build. The runtime copies the verified model bundle; startup never downloads or updates a model.

The Go builder pins `golang.org/x/net` and `golang.org/x/crypto`, verifies Go module checksums, and requires focused tests plus govulncheck source and final-binary scans to pass. The final runtime starts from an immutable Ollama image digest and upgrades its Ubuntu packages only from the immutable official Ubuntu snapshot `20261124T000000Z`, with apt signature verification enabled. The build requires libc6 at least `2.39-0ubuntu8.12`.

The image remains a candidate until an exact-digest Trivy scan, private candidate API-to-Core generation, quota/audit/no-fallback checks, and bounded cold/warm runtime measurements pass. It must be deployed only as a private Core app with one maximum replica; this image does not authorize deployment or production provider activation.
