# Scrolith Core is built from the exact reviewed upstream Ollama source with
# management/download surfaces removed from this inference-only appliance.
FROM golang:1.26.11-bookworm@sha256:79ecd0a7157c7a4cf3b281ced8465350591bf54fedab540e75374a003e1fde7e AS ollama-core-build
ARG ACR_BUILD_NONCE
ARG OLLAMA_SOURCE_COMMIT=23b94a2daf2cd1fbf6b4dcfbfd3efbaca424b7bf
ARG OLLAMA_SOURCE_TAG=v0.40.17
WORKDIR /src
RUN git init \
  && git remote add origin https://github.com/ollama/ollama.git \
  && git fetch --depth=1 origin "refs/tags/${OLLAMA_SOURCE_TAG}:refs/tags/${OLLAMA_SOURCE_TAG}" \
  && test "$(git rev-parse "${OLLAMA_SOURCE_TAG}^{commit}")" = "${OLLAMA_SOURCE_COMMIT}" \
  && git checkout --detach "${OLLAMA_SOURCE_COMMIT}" \
  && test "$(git describe --tags --exact-match HEAD)" = "${OLLAMA_SOURCE_TAG}" \
  && test -n "${ACR_BUILD_NONCE}"
COPY ollama-core-hardening.patch /tmp/ollama-core-hardening.patch
COPY ollama-core-hardening/ /tmp/ollama-core-hardening/
RUN git apply --unidiff-zero /tmp/ollama-core-hardening.patch \
  && cp /tmp/ollama-core-hardening/main_scrolithcore.go ./main_scrolithcore.go \
  && cp /tmp/ollama-core-hardening/main_scrolithcore_test.go ./main_scrolithcore_test.go \
  && cp /tmp/ollama-core-hardening/cmd/scrolith_core_cli_test.go ./cmd/scrolith_core_cli_test.go \
  && cp /tmp/ollama-core-hardening/cmd/scrolith_core_disabled.go ./cmd/scrolith_core_disabled.go \
  && cp /tmp/ollama-core-hardening/cmd/scrolith_core_enabled.go ./cmd/scrolith_core_enabled.go \
  && cp /tmp/ollama-core-hardening/server/scrolith_core_disabled.go ./server/scrolith_core_disabled.go \
  && cp /tmp/ollama-core-hardening/server/scrolith_core_enabled.go ./server/scrolith_core_enabled.go \
  && cp /tmp/ollama-core-hardening/server/scrolith_core_routes_test.go ./server/scrolith_core_routes_test.go \
  && test -n "${ACR_BUILD_NONCE}"
# Pin vulnerable direct Go modules, verify module checksums, and make both
# source- and binary-level vulnerability checks mandatory image-build gates.
RUN go get golang.org/x/net@v0.62.0 golang.org/x/crypto@v0.59.0 \
  && go mod download \
  && go mod verify \
  && go test -tags=scrolithcore . ./server ./cmd -run '^TestScrolithCore' -count=1 \
  && test -n "${ACR_BUILD_NONCE}"
RUN go install golang.org/x/vuln/cmd/govulncheck@v1.10.0 \
  && mkdir -p /out \
  && govulncheck -json -tags=scrolithcore . > /out/govulncheck-source.jsonl 2>&1 \
  && if grep -Fq '"finding":' /out/govulncheck-source.jsonl; then printf 'Source-mode govulncheck findings detected; raw report retained in the build stage.\n' >&2; cat /out/govulncheck-source.jsonl; exit 1; fi \
  && printf 'Source-mode govulncheck completed with no findings; raw report retained in the build stage.\n' \
  && CGO_ENABLED=1 go build -trimpath -buildmode=pie -ldflags="-w" -tags=scrolithcore -o /out/ollama-analysis . \
  && govulncheck -json -mode=binary /out/ollama-analysis > /out/govulncheck-binary.jsonl 2>&1 \
  && go run /tmp/ollama-core-hardening/verify_govuln_report.go /out/govulncheck-binary.jsonl \
  && CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/verify-model-manifest /tmp/ollama-core-hardening/modelmanifest/verify_model_manifest.go \
  && CGO_ENABLED=1 go build -trimpath -buildmode=pie -ldflags="-w -s" -tags=scrolithcore -o /out/ollama . \
  && test -n "${ACR_BUILD_NONCE}"

# Pull the model in a separate pinned upstream stage. The mutable model tag is
# accepted only if its pinned manifest and every installed layer descriptor match.
FROM ollama/ollama:0.40.17@sha256:5e5802d3c018ecdee7c7dff32a7e3b10ca9a2c4b3a461392cff97c313c2af0fc AS qwen-model-bundle
ARG ACR_BUILD_NONCE
ENV OLLAMA_HOST=127.0.0.1:11434
ENV OLLAMA_MODELS=/models
COPY --from=ollama-core-build /out/verify-model-manifest /usr/local/bin/verify-model-manifest
COPY model-manifests/qwen3-8b.json /etc/scrolith/qwen3-8b.manifest.json
RUN useradd --system --create-home --home-dir /home/ollama ollama \
  && mkdir -p /models \
  && chmod 0755 /usr/local/bin/verify-model-manifest \
  && chown -R ollama:ollama /models \
  && test -n "${ACR_BUILD_NONCE}"
USER ollama
RUN /bin/sh -c 'set -eu; \
  ollama serve >/tmp/ollama-model-bundle.log 2>&1 & \
  OLLAMA_PID=$!; \
  cleanup() { kill "${OLLAMA_PID}" >/dev/null 2>&1 || true; wait "${OLLAMA_PID}" >/dev/null 2>&1 || true; }; \
  trap cleanup EXIT INT TERM; \
  attempt=0; \
  until ollama list >/dev/null 2>&1; do \
    attempt=$((attempt + 1)); \
    if [ "${attempt}" -ge 120 ]; then cat /tmp/ollama-model-bundle.log; exit 1; fi; \
    sleep 1; \
  done; \
  ollama pull qwen3:8b; \
  manifest=/models/manifests-v2/ollama.com/library/qwen3/8b; \
  /usr/local/bin/verify-model-manifest /etc/scrolith/qwen3-8b.manifest.json "${manifest}"; \
  ollama show qwen3:8b >/dev/null; \
  test -n "${ACR_BUILD_NONCE}"'

# Preserve the reviewed Ollama runtime libraries and advance the Ubuntu base
# only from this immutable official archive snapshot with apt signature checks.
FROM ollama/ollama:0.40.17@sha256:5e5802d3c018ecdee7c7dff32a7e3b10ca9a2c4b3a461392cff97c313c2af0fc AS runtime
ARG ACR_BUILD_NONCE
USER root
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update --snapshot 20261124T000000Z \
  && apt-get upgrade --yes --no-install-recommends --snapshot 20261124T000000Z \
  && libc_version="$(dpkg-query -W -f='${Version}' libc6)" \
  && dpkg --compare-versions "${libc_version}" ge 2.39-0ubuntu8.12 \
  && printf 'Verified fixed libc6 package: %s\n' "${libc_version}" \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && test -n "${ACR_BUILD_NONCE}"
RUN useradd --system --create-home --home-dir /home/ollama ollama \
  && mkdir -p /models \
  && test -n "${ACR_BUILD_NONCE}"
COPY --from=ollama-core-build /out/ollama /usr/bin/ollama
COPY --from=qwen-model-bundle --chown=ollama:ollama /models /models
COPY start.sh /usr/local/bin/scrolitha-core-start
RUN chmod 0755 /usr/local/bin/scrolitha-core-start /usr/bin/ollama
USER ollama
ENV OLLAMA_HOST=0.0.0.0:8080 \
  OLLAMA_MODELS=/models \
  SCROLITHA_OLLAMA_MODEL=qwen3:8b \
  OLLAMA_CONTEXT_LENGTH=4096 \
  OLLAMA_MAX_LOADED_MODELS=1 \
  OLLAMA_NUM_PARALLEL=1 \
  OLLAMA_KEEP_ALIVE=30m \
  OLLAMA_NO_CLOUD=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["/usr/bin/ollama", "--healthcheck"]
ENTRYPOINT ["/bin/sh", "/usr/local/bin/scrolitha-core-start"]
