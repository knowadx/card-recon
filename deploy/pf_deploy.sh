#!/usr/bin/env bash
# pf_deploy.sh — sobe código novo do PixelFinance. Roda NO VPS, dentro da pasta do repositório.
#
# Molde: deploy/deploy.sh do Hash (mesmas lições), adaptado ao Next + Prisma. Ordem:
#   1 código (pull + re-exec) → 2 banco de pé → 3 imagens → 4 migrations → 5 subir → 6 saúde → crons
#
# Saída (o pf_auto_deploy.sh decide por ela):
#   0     = no ar; o commit fica gravado em ~/.pixelfinance-deploy-ok
#   3     = ABORTADO antes de trocar o app (pull, banco, build ou migration): containers no ar
#           intocados, checkout de volta no commit anterior, motivo em ~/.pixelfinance-deploy-aborto
#   outro = falhou DEPOIS de começar a trocar o app (passos 5-6)
#
# Convive com o Hash no mesmo VPS sem encostar nele: projeto Docker "pixelfinance" (nome no
# docker-compose.yml), marcas próprias no $HOME e linhas próprias no crontab (marcador
# "#pixelfinance"). Os nomes pf_*.sh existem porque o deploy.sh do Hash APAGA do crontab
# qualquer linha com "deploy/backup.sh", "deploy/restore.sh --ensaio" ou "deploy/auto_deploy.sh".
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

MARCA_OK="$HOME/.pixelfinance-deploy-ok"
MARCA_ABORTO="$HOME/.pixelfinance-deploy-aborto"

log() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }
dc() { docker compose "$@"; }

[ -f .env ] || { echo "sem .env — copie deploy/env.exemplo para .env e preencha (deploy/README.md)"; exit 1; }
grep -qE '^POSTGRES_PASSWORD=[A-Za-z0-9]{16,}$' .env || { echo "POSTGRES_PASSWORD ausente ou fraca no .env (16+ letras/números)"; exit 1; }
grep -qE '^SESSION_SECRET=.{24,}$' .env || { echo "SESSION_SECRET ausente ou curto no .env (24+ caracteres)"; exit 1; }

# Túnel: só sobe o cloudflared quando o token existe (instalação nova pode subir sem ele)
TUNEL=""
[ -s deploy/segredos/tunel_token ] && TUNEL=1

abortar_cedo() {
    local motivo="$*"
    echo "  ✗ $motivo"
    if [ -n "${IMAGENS_NOVAS:-}" ]; then
        echo "    os containers no ar NÃO foram tocados, mas as imagens já foram reconstruídas:"
        echo "    NÃO rode \`docker compose up -d\` à mão até um deploy dar certo (app novo × banco velho)"
    fi
    if [ -n "${PF_DEPLOY_ANTES:-}" ] && [ "$(git rev-parse HEAD)" != "$PF_DEPLOY_ANTES" ]; then
        if git reset -q --keep "$PF_DEPLOY_ANTES"; then
            echo "    checkout de volta em ${PF_DEPLOY_ANTES:0:7} — o próximo ciclo do auto-deploy tenta de novo"
        else
            echo "    ⚠️ não consegui voltar o checkout pra ${PF_DEPLOY_ANTES:0:7} (mudança local no VPS?)"
            motivo="$motivo — ⚠️ o checkout NÃO voltou"
        fi
    fi
    printf '%s\n' "$motivo" > "$MARCA_ABORTO" 2>/dev/null || true
    exit 3
}

log "1/6 — código"
# O `git pull` reescreve ESTE arquivo e o bash continuaria lendo a versão velha pelo descritor
# aberto (lição do Hash, ago/02): depois de puxar, re-executa o script novo (uma vez só).
if [ "${PF_DEPLOY_REEXEC:-}" != "1" ]; then
    PF_DEPLOY_ANTES="$(git rev-parse HEAD)"
    export PF_DEPLOY_ANTES
    git pull --ff-only || abortar_cedo "git pull falhou — nada foi trocado"
    export PF_DEPLOY_REEXEC=1
    exec bash "$0" "$@"
fi

log "2/6 — banco de pé"
dc up -d postgres || abortar_cedo "não consegui subir o postgres — deploy abortado antes do build"
pronto=""
for _ in $(seq 40); do
    dc exec -T postgres pg_isready -U pixelfinance -d pixelfinance >/dev/null 2>&1 && { pronto=1; break; }
    sleep 2
done
[ -n "$pronto" ] || abortar_cedo "postgres não ficou pronto em 80 s — dc logs postgres --tail 50"

log "3/6 — imagens"
IMAGENS_NOVAS=1
dc --profile ferramentas build app migrate || abortar_cedo "build falhou"

log "4/6 — migrations"
# prisma migrate deploy só aplica o que falta e registra em _prisma_migrations; banco vazio
# (instalação nova) nasce aqui, e os dados vêm depois pelo script de importação.
dc --profile ferramentas run --rm migrate \
    || abortar_cedo "migration falhou — o app no ar segue com o código e o esquema anteriores"

# ── PONTO SEM VOLTA: daqui pra baixo o app é trocado ─────────────────────────
# Nenhuma falha daqui em diante pode sair com 3 (o 3 diz "nada foi trocado").
trap '[ $? -ne 3 ] || exit 1' EXIT

ALVO=(app)
[ -n "$TUNEL" ] && ALVO+=(cloudflared)
PERFIS=(--profile producao)

log "5/6 — subindo: ${ALVO[*]}"
# Um serviço preso não pode derrubar os outros (lição do Hash, ago/12): 2ª tentativa limpando.
if ! dc "${PERFIS[@]}" up -d "${ALVO[@]}"; then
    echo "  ⚠️ up -d falhou — removendo containers presos e tentando de novo"
    dc "${PERFIS[@]}" rm -sf "${ALVO[@]}" >/dev/null 2>&1 || true
    dc "${PERFIS[@]}" up -d --remove-orphans "${ALVO[@]}"
fi

log "6/6 — saúde"
ok=""
for _ in $(seq 40); do
    if dc exec -T app wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"ok":true'; then ok=1; break; fi
    sleep 3
done
[ -n "$ok" ] || { echo "  ✗ o app não respondeu /api/health com o banco ok — dc logs app --tail 50"; exit 1; }
echo "  ✓ app e banco respondendo"

# confere serviço a serviço (o /health prova o app e mais nada)
ESSENCIAIS="postgres app"
[ -n "$TUNEL" ] && ESSENCIAIS="$ESSENCIAIS cloudflared"
CAIDOS=""
for s in $ESSENCIAIS; do
    est="$(dc "${PERFIS[@]}" ps --format '{{.Service}} {{.State}}' 2>/dev/null | awk -v s="$s" '$1==s{print $2}')"
    case "$est" in
        running) ;;
        "") CAIDOS="$CAIDOS $s(ausente)" ;;
        *) CAIDOS="$CAIDOS $s($est)" ;;
    esac
done
[ -z "$CAIDOS" ] || { echo "  ✗ serviço(s) fora depois do deploy:$CAIDOS"; exit 1; }
echo "  ✓ essenciais de pé: $ESSENCIAIS"
[ -n "$TUNEL" ] || echo "  ⚠️ sem deploy/segredos/tunel_token: o app está de pé mas SEM túnel (ninguém de fora acessa)"

# ── crons do PixelFinance (só as linhas marcadas #pixelfinance; as do Hash ficam intactas) ──
mkdir -p "$HOME/backups/pixelfinance"
BACKUP="30 3 * * * cd $RAIZ && bash deploy/pf_backup.sh >> \$HOME/backups/pixelfinance/backup.log 2>&1 #pixelfinance"
ENSAIO="30 4 * * 0 cd $RAIZ && bash deploy/pf_restore.sh --ensaio >> \$HOME/backups/pixelfinance/ensaio.log 2>&1 #pixelfinance"
AUTO="*/15 * * * * flock -n /tmp/pixelfinance-auto-deploy.lock bash $RAIZ/deploy/pf_auto_deploy.sh >> \$HOME/pixelfinance-deploy-auto.log 2>&1 #pixelfinance"
ATUAL="$(crontab -l 2>/dev/null || true)"
LIMPO="$(printf '%s\n' "$ATUAL" | grep -vF '#pixelfinance' || true)"
printf '%s\n%s\n%s\n%s\n' "$LIMPO" "$BACKUP" "$ENSAIO" "$AUTO" | grep -v '^[[:space:]]*$' | crontab -

dc "${PERFIS[@]}" ps --format 'table {{.Service}}\t{{.Status}}' || true

# disco do VPS é apertado: apaga SÓ imagens antigas (sem tag) DO PixelFinance — nunca as do Hash
docker image prune -f --filter "label=com.docker.compose.project=pixelfinance" >/dev/null 2>&1 || true
log "PixelFinance no ar"

# ÚLTIMO comando: a marca quer dizer "o deploy chegou ao fim" (saúde E crons)
git rev-parse HEAD > "$MARCA_OK"
rm -f "$MARCA_ABORTO"
