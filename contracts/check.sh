#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspace"
INVARIANTS="$ROOT/contracts/invariants.toml"

if [[ ! -f "$INVARIANTS" ]]; then
  echo "[contracts] invariants.toml nao encontrado" >&2
  exit 1
fi

mapfile -t files < <(grep -E '^file\s*=\s*"' "$INVARIANTS" | sed -E 's/^file\s*=\s*"([^"]+)"/\1/')

if [[ ${#files[@]} -eq 0 ]]; then
  echo "[contracts] nenhum programa definido em invariants.toml" >&2
  exit 1
fi

for rel in "${files[@]}"; do
  if [[ ! -f "$ROOT/$rel" ]]; then
    echo "[contracts] arquivo invariante ausente: $rel" >&2
    exit 1
  fi
done

echo "[contracts] checagem estrutural concluida (${#files[@]} programas)"
