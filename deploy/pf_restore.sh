#!/usr/bin/env bash
# pf_restore.sh — restauração do banco do PixelFinance. Molde: restore.sh do Hash.
#
#   --ensaio [pasta]   restaura o dump (padrão: o mais recente) num Postgres DESCARTÁVEL e confere
#                      que as tabelas principais voltaram. Não toca a produção. Roda no cron de domingo.
#   --valendo <pasta>  restaura POR CIMA da produção. Pede que se digite RESTAURAR.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINO="${DESTINO:-$HOME/backups/pixelfinance}"
cd "$RAIZ"

log() { printf '\033[1;35m▸ %s\033[0m\n' "$*"; }

ultimo() { ls -1d "$DESTINO"/20* 2>/dev/null | sort | tail -1; }

MODO="${1:-}"
PASTA="${2:-}"
case "$MODO" in
    --ensaio) PASTA="${PASTA:-$(ultimo)}" ;;
    --valendo) [ -n "$PASTA" ] || { echo "uso: $0 --valendo <pasta do backup>"; exit 1; } ;;
    *) echo "uso: $0 --ensaio [pasta] | --valendo <pasta>"; exit 1 ;;
esac
[ -s "$PASTA/banco.dump" ] || { echo "sem banco.dump em '$PASTA'"; exit 1; }

if [ "$MODO" = "--ensaio" ]; then
    NOME="pf-ensaio-$(date +%s)"
    log "ensaio: restaurando $(basename "$PASTA") num Postgres descartável ($NOME)"
    docker run -d --rm --name "$NOME" -e POSTGRES_PASSWORD=ensaio -e POSTGRES_DB=ensaio postgres:16-alpine >/dev/null
    trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
    for _ in $(seq 40); do
        docker exec "$NOME" pg_isready -U postgres -d ensaio >/dev/null 2>&1 && break
        sleep 2
    done
    sleep 3 # o pg_isready responde "pronto" no servidor temporário do initdb (lição do Hash)
    docker exec -i "$NOME" pg_restore -U postgres -d ensaio --no-owner < "$PASTA/banco.dump"
    FALTAS=""
    for t in User Holding Company Account Transaction Category; do
        n="$(docker exec "$NOME" psql -U postgres -d ensaio -tAc "select count(*) from \"$t\"" 2>/dev/null || echo ERRO)"
        echo "  $t: $n"
        [ "$n" = "ERRO" ] && FALTAS="$FALTAS $t"
    done
    [ -z "$FALTAS" ] || { echo "  ✗ ENSAIO REPROVADO — tabelas faltando:$FALTAS"; exit 1; }
    log "ensaio aprovado: o backup $(basename "$PASTA") restaura"
    exit 0
fi

# --valendo
echo "Isto APAGA o banco de produção do PixelFinance e põe no lugar o backup $(basename "$PASTA")."
read -r -p "Digite RESTAURAR para continuar: " CONFIRMA
[ "$CONFIRMA" = "RESTAURAR" ] || { echo "cancelado"; exit 1; }
log "parando o app (o túnel continua de pé)"
docker compose stop app
log "recriando o banco e restaurando"
docker compose exec -T postgres psql -U pixelfinance -d postgres -c 'DROP DATABASE IF EXISTS pixelfinance WITH (FORCE)'
docker compose exec -T postgres psql -U pixelfinance -d postgres -c 'CREATE DATABASE pixelfinance OWNER pixelfinance'
docker compose exec -T postgres pg_restore -U pixelfinance -d pixelfinance --no-owner < "$PASTA/banco.dump"
log "subindo o app"
docker compose --profile producao up -d app
log "restaurado. Confira: docker compose exec app wget -qO- http://127.0.0.1:3000/api/health"
