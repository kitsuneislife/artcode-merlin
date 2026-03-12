#!/usr/bin/env bash
# Acompanha o progresso do Merlin em tempo real de forma legível.
# Uso: ./scripts/watch.sh [logs|status|fork]

set -euo pipefail

FORK="fork/artcode"
BUILD_RESULT="stages/active/build-result.json"

cmd="${1:-logs}"

case "$cmd" in
  logs)
    echo "==> Logs em tempo real (Ctrl+C para sair)"
    docker compose logs -f merlin-agent 2>/dev/null \
      | jq --unbuffered -r '
          .level as $lvl |
          if   $lvl == "error" then "\u001b[31m[ERRO]\u001b[0m"
          elif $lvl == "warn"  then "\u001b[33m[AVISO]\u001b[0m"
          elif $lvl == "info"  then "\u001b[32m[INFO]\u001b[0m"
          else                      "[\($lvl | ascii_upcase)]"
          end as $prefix |
          (.timestamp | split("T")[1] | split(".")[0]) as $time |
          if .data then
            "\($time) \($prefix) \(.message)  \(.data | tostring)"
          else
            "\($time) \($prefix) \(.message)"
          end
        '
    ;;

  status)
    echo "=== STATUS ATUAL ==="
    echo ""

    echo "--- Serviços Docker ---"
    docker compose ps --format "table {{.Service}}\t{{.Status}}" 2>/dev/null || echo "(stack não está rodando)"
    echo ""

    echo "--- Último build ---"
    if [ -f "$BUILD_RESULT" ]; then
      jq -r '"Status : \(.status)\nStage  : \(.stage_id)\nMotivo : \(.reason // "-")"' "$BUILD_RESULT"
    else
      echo "(nenhum build registrado ainda)"
    fi
    echo ""

    echo "--- Fork: commits à frente do original ---"
    if [ -d "$FORK/.git" ]; then
      COUNT=$(git -C "$FORK" rev-list HEAD --count 2>/dev/null || echo 0)
      echo "$COUNT commits no fork"
      echo ""
      echo "--- Últimos 5 commits ---"
      git -C "$FORK" log --oneline -5 2>/dev/null || echo "(sem commits)"
    else
      echo "(fork ainda não foi clonado)"
    fi
    ;;

  fork)
    echo "=== GIT LOG DO FORK ==="
    if [ -d "$FORK/.git" ]; then
      git -C "$FORK" log --oneline --graph --decorate 2>/dev/null
    else
      echo "(fork ainda não foi clonado)"
    fi
    ;;

  *)
    echo "Uso: $0 [logs|status|fork]"
    echo ""
    echo "  logs    Acompanha logs do agente em tempo real (padrão)"
    echo "  status  Mostra estado atual: serviços, último build, commits do fork"
    echo "  fork    Mostra git log completo do fork"
    exit 1
    ;;
esac
