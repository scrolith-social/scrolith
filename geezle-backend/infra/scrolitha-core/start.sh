#!/bin/sh
set -eu

EXPECTED_MODEL="qwen3:8b"
MODEL="${SCROLITHA_OLLAMA_MODEL:-qwen3:8b}"
READY_RETRIES="${SCROLITHA_READY_RETRIES:-300}"
READY_SLEEP_SECONDS="${SCROLITHA_READY_SLEEP_SECONDS:-1}"

if [ "${MODEL}" != "${EXPECTED_MODEL}" ]; then
  echo "Scrolith Core image does not support the configured model."
  exit 1
fi
case "${READY_RETRIES}" in
  ''|*[!0-9]*) echo "Invalid Scrolith Core readiness retry setting."; exit 1 ;;
esac
if [ "${READY_RETRIES}" -lt 1 ] || [ "${READY_RETRIES}" -gt 300 ]; then
  echo "Scrolith Core readiness retry setting is outside the supported bound."
  exit 1
fi
case "${READY_SLEEP_SECONDS}" in
  ''|*[!0-9]*) echo "Invalid Scrolith Core readiness interval."; exit 1 ;;
esac
if [ "${READY_SLEEP_SECONDS}" -lt 1 ] || [ "${READY_SLEEP_SECONDS}" -gt 5 ]; then
  echo "Scrolith Core readiness interval is outside the supported bound."
  exit 1
fi

export OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0:8080}"
export OLLAMA_MODELS="${OLLAMA_MODELS:-/models}"
export OLLAMA_CONTEXT_LENGTH="${OLLAMA_CONTEXT_LENGTH:-4096}"
export OLLAMA_MAX_LOADED_MODELS="${OLLAMA_MAX_LOADED_MODELS:-1}"
export OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-1}"
export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-30m}"
export OLLAMA_NO_CLOUD="${OLLAMA_NO_CLOUD:-1}"

/usr/bin/ollama serve &
OLLAMA_PID=$!

cleanup() {
  kill "${OLLAMA_PID}" >/dev/null 2>&1 || true
  wait "${OLLAMA_PID}" >/dev/null 2>&1 || true
}

trap cleanup INT TERM EXIT

attempt=0
until /usr/bin/ollama --healthcheck >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "${attempt}" -ge "${READY_RETRIES}" ]; then
    echo "Scrolith Core runtime failed its pinned-model readiness check."
    exit 1
  fi
  sleep "${READY_SLEEP_SECONDS}"
done

echo "Scrolith Core runtime is ready with its pinned image-bundled model."
wait "${OLLAMA_PID}"