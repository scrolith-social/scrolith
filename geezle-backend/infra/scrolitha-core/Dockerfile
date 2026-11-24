# Rebuild the official Ollama v0.40.17 source with patched x/net and x/crypto
# versions. The upstream image is pinned below; only its Go executable is
# replaced, while its reviewed CPU runtime libraries remain intact.
FROM golang:1.26.11-bookworm@sha256:79ecd0a7157c7a4cf3b281ced8465350591bf54fedab540e75374a003e1fde7e AS ollama-patched-build
ARG OLLAMA_SOURCE_COMMIT=23b94a2daf2cd1fbf6b4dcfbfd3efbaca424b7bf
ARG OLLAMA_SOURCE_TAG=v0.40.17
WORKDIR /src
RUN git init \
  && git remote add origin https://github.com/ollama/ollama.git \
  && git fetch --depth=1 origin "refs/tags/${OLLAMA_SOURCE_TAG}:refs/tags/${OLLAMA_SOURCE_TAG}" \
  && test "$(git rev-parse "${OLLAMA_SOURCE_TAG}^{commit}")" = "${OLLAMA_SOURCE_COMMIT}" \
  && git checkout --detach "${OLLAMA_SOURCE_COMMIT}" \
  && test "$(git describe --tags --exact-match HEAD)" = "${OLLAMA_SOURCE_TAG}"
RUN go get golang.org/x/net@v0.62.0 golang.org/x/crypto@v0.59.0 \
  && go mod download \
  && go mod verify \
  && mkdir -p /out \
  && CGO_ENABLED=1 go build -trimpath -buildmode=pie -ldflags="-w -s" -o /out/ollama .

FROM ollama/ollama:0.40.17@sha256:5e5802d3c018ecdee7c7dff32a7e3b10ca9a2c4b3a461392cff97c313c2af0fc
COPY --from=ollama-patched-build /out/ollama /usr/bin/ollama

ARG SCROLITHA_OLLAMA_MODEL=qwen3:8b
ENV OLLAMA_HOST=0.0.0.0:8080
ENV SCROLITHA_OLLAMA_MODEL=${SCROLITHA_OLLAMA_MODEL}
ENV OLLAMA_MODELS=/models
# Bound inference memory and keep the loaded model local to this runtime.
ENV OLLAMA_CONTEXT_LENGTH=4096
ENV OLLAMA_MAX_LOADED_MODELS=1
ENV OLLAMA_NUM_PARALLEL=1
ENV OLLAMA_KEEP_ALIVE=30m
ENV OLLAMA_NO_CLOUD=1

COPY infra/scrolitha-core/start.sh /usr/local/bin/scrolitha-core-start

RUN useradd --system --create-home --home-dir /home/ollama ollama \
  && mkdir -p /models \
  && chown -R ollama:ollama /models \
  && chmod +x /usr/local/bin/scrolitha-core-start

# Pull the model as its runtime user so the image does not need a second,
# full-size chown layer after the model is downloaded.
USER ollama

RUN /bin/sh -c 'set -eu; \
  case "${SCROLITHA_OLLAMA_MODEL}" in qwen3:8b) ;; *) echo "Unsupported Scrolitha Core model for the 8 GiB profile." >&2; exit 1 ;; esac; \
  ollama serve >/tmp/ollama-build.log 2>&1 & \
  OLLAMA_PID=$!; \
  cleanup() { kill "${OLLAMA_PID}" >/dev/null 2>&1 || true; wait "${OLLAMA_PID}" >/dev/null 2>&1 || true; }; \
  trap cleanup EXIT INT TERM; \
  attempt=0; \
  until ollama list >/dev/null 2>&1; do \
    attempt=$((attempt + 1)); \
    if [ "$attempt" -ge 120 ]; then \
      cat /tmp/ollama-build.log; \
      exit 1; \
    fi; \
    sleep 1; \
  done; \
  pull_attempt=0; \
  until ollama pull "${SCROLITHA_OLLAMA_MODEL}"; do \
    pull_attempt=$((pull_attempt + 1)); \
    if [ "${pull_attempt}" -ge 4 ]; then \
      echo "Failed to pull the configured Scrolitha Core model after 4 attempts." >&2; \
      exit 1; \
    fi; \
    sleep $((pull_attempt * 5)); \
  done; \
  ollama show "${SCROLITHA_OLLAMA_MODEL}" >/dev/null \
'

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["ollama", "list"]

ENTRYPOINT ["/bin/sh", "/usr/local/bin/scrolitha-core-start"]
