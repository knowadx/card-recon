#!/usr/bin/env bash
# pf_backup.sh — cópia do que NÃO se recria: banco do PixelFinance e segredos. Molde: backup.sh do Hash.
#   banco.dump  — pg_dump formato custom (restaura tabela a tabela)
#   env.txt     — o .env (modo 600)
#   commit.txt  — versão do código no momento do backup
# Os arquivos (faturas, documentos) ficam no Cloudflare R2 e não passam por aqui.
#
# Uso:  bash deploy/pf_backup.sh            → ~/backups/pixelfinance/<data>
#       DESTINO=/mnt/x bash deploy/pf_backup.sh
# Fail-closed: se o dump falhar, sai SEM apagar backups antigos.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINO="${DESTINO:-$HOME/backups/pixelfinance}"
MANTER_DIAS="${MANTER_DIAS:-14}"
CARIMBO="$(date +%Y-%m-%d_%H%M)"
PASTA="$DESTINO/$CARIMBO"

log() { printf '\033[1;35m▸ %s\033[0m\n' "$*"; }

cd "$RAIZ"
mkdir -p "$PASTA"

log "banco (pg_dump)"
docker compose exec -T postgres pg_dump -U pixelfinance -Fc pixelfinance > "$PASTA/banco.dump"
[ -s "$PASTA/banco.dump" ] || { echo "dump saiu vazio — abortado (backups antigos preservados)"; exit 1; }

log "segredos (.env)"
if [ -f "$RAIZ/.env" ]; then
    cp "$RAIZ/.env" "$PASTA/env.txt"
    chmod 600 "$PASTA/env.txt"
fi
git -C "$RAIZ" rev-parse HEAD > "$PASTA/commit.txt" 2>/dev/null || true
du -sh "$PASTA"/* > "$PASTA/manifesto.txt"

log "expurgo (> ${MANTER_DIAS} dias)"
find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime "+$MANTER_DIAS" -exec rm -rf {} + 2>/dev/null || true

if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null; then
    log "enviando pro ${RCLONE_REMOTE}"
    rclone copy "$PASTA" "${RCLONE_REMOTE}/${CARIMBO}" --transfers 4
else
    echo "  (sem RCLONE_REMOTE — backup só local)"
fi

cat "$PASTA/manifesto.txt"
log "pronto: $PASTA"
