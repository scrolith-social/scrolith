#!/bin/sh
set -eu

MODEL="${SCROLITHA_OLLAMA_MODEL:-qwen3:8b}"
READY_RETRIES="${SCROLITHA_READY_RETRIES:-120}"
READY_SLEEP_SECONDS="${SCROLITHA_READY_SLEEP_SECONDS:-1}"

export OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0:8080}"
export OLLAMA_CONTEXT_LENGTH="${OLLAMA_CONTEXT_LENGTH:-4096}"
export OLLAMA_MAX_LOADED_MODELS="${OLLAMA_MAX_LOADED_MODELS:-1}"
export OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-1}"
export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-30m}"
export OLLAMA_NO_CLOUD="${OLLAMA_NO_CLOUD:-1}"

ollama serve &
OLLAMA_PID=$!

cleanup() {
  kill "${OLLAMA_PID}" >/dev/null 2>&1 || true
  wait "${OLLAMA_PID}" >/dev/null 2>&1 || true
}

trap cleanup INT TERM EXIT

attempt=0
until ollama list >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "${attempt}" -ge "${READY_RETRIES}" ]; then
    echo "Scrolitha Core runtime failed to become ready."
    exit 1
  fi
  sleep "${READY_SLEEP_SECONDS}"
done

if ! ollama show "${MODEL}" >/dev/null 2>&1; then
  echo "Scrolitha Core image is missing its configured model; refusing a runtime download."
  exit 1
fi

echo "Scrolitha Core runtime is ready with its image-bundled model."
wait "${OLLAMA_PID}"
