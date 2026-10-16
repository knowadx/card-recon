#!/usr/bin/env bash
# pf_auto_deploy.sh — cron a cada 15 min (com flock -n): roda o pf_deploy.sh quando o branch
# remoto avança OU quando o último deploy não chegou ao fim. Molde: auto_deploy.sh do Hash.
#
# Branch: o que estiver em checkout no VPS (durante a homologação, o da Fase 0; depois, main).
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"
MARCA_OK="$HOME/.pixelfinance-deploy-ok"
TENTATIVAS="$HOME/.pixelfinance-deploy-tentativas"
LIMITE_POS_UP=2

agora() { date '+%Y-%m-%d %H:%M:%S'; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git fetch -q origin "$BRANCH" || { echo "$(agora) fetch falhou — tento no próximo ciclo"; exit 0; }
LOCAL="$(git rev-parse HEAD)"
REMOTO="$(git rev-parse "origin/$BRANCH")"
INSTALADO="$(cat "$MARCA_OK" 2>/dev/null || true)"

if [ "$LOCAL" = "$REMOTO" ] && [ "$INSTALADO" = "$LOCAL" ]; then
    exit 0 # nada novo e o último deploy chegou ao fim
fi

# limite de tentativas por commit quando a falha é DEPOIS de trocar o app (não insiste pra sempre)
ALVO="$REMOTO"
CONT="$(awk -v c="$ALVO" '$1==c{print $2}' "$TENTATIVAS" 2>/dev/null || true)"
CONT="${CONT:-0}"
if [ "$CONT" -ge "$LIMITE_POS_UP" ]; then
    echo "$(agora) ${ALVO:0:7}: já falhou $CONT vezes depois do up — parado até alguém olhar (apague $TENTATIVAS)"
    exit 0
fi

echo "$(agora) deploy de ${ALVO:0:7} (local ${LOCAL:0:7}, instalado ${INSTALADO:0:7})"
set +e
bash "$RAIZ/deploy/pf_deploy.sh"
SAIDA=$?
set -e

case "$SAIDA" in
    0)
        echo "$(agora) ✓ no ar: $(git rev-parse --short HEAD)"
        rm -f "$TENTATIVAS"
        ;;
    3)
        # nada foi trocado (pull, banco, build ou migration): sem auto-cura, tenta no próximo ciclo
        echo "$(agora) ✗ abortado antes de trocar o app: $(cat "$HOME/.pixelfinance-deploy-aborto" 2>/dev/null)"
        ;;
    *)
        echo "$(agora) ✗ falhou depois de trocar o app (saída $SAIDA) — tentativa $((CONT + 1)) de $LIMITE_POS_UP"
        { grep -v "^$ALVO " "$TENTATIVAS" 2>/dev/null || true; echo "$ALVO $((CONT + 1))"; } > "$TENTATIVAS.tmp"
        mv "$TENTATIVAS.tmp" "$TENTATIVAS"
        ;;
esac
