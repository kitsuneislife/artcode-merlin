#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/docker/.env.example"

command -v docker >/dev/null 2>&1 || {
  echo "[merlin] docker nao encontrado no PATH" >&2
  exit 1
}

if ! docker compose version >/dev/null 2>&1; then
  echo "[merlin] docker compose nao disponivel" >&2
  exit 1
fi

mkdir -p \
  "$ROOT_DIR/fork/artcode" \
  "$ROOT_DIR/stages/active" \
  "$ROOT_DIR/stages/validated" \
  "$ROOT_DIR/stages/integrated" \
  "$ROOT_DIR/baselines" \
  "$ROOT_DIR/db" \
  "$ROOT_DIR/logs"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "[merlin] .env criado a partir de docker/.env.example"
fi

docker compose up -d --build ollama
docker compose exec ollama ollama pull "${OLLAMA_MODEL:-qwen2.5-coder:7b}"
docker compose up -d merlin-agent

echo "[merlin] stack iniciada"
