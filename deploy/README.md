# Produção — como o PixelFinance roda no ar

Mesmo padrão do Hash (`hash-ads/deploy/README.md`): VPS Linux + Docker + Postgres 16 + túnel da
Cloudflare (nenhuma porta aberta) + login pela Cloudflare Access + deploy automático + backup com
ensaio de restauração. Os arquivos (faturas, documentos) ficam no Cloudflare R2.

Por enquanto mora **no mesmo VPS do Hash**, mas montado para sair dele sem dor (seção "Separar").

## Peças

| Arquivo | Faz |
|---|---|
| `docker-compose.yml` (raiz) | projeto `pixelfinance`: `postgres`, `app`, `cloudflared` (perfil `producao`) e `migrate` (perfil `ferramentas`). Redes `interno` (app↔banco) e `borda` (túnel↔app): o túnel não alcança o banco. Nenhuma porta publicada |
| `Dockerfile` (raiz) | alvos `app` (Next standalone, usuário sem privilégio) e `migrate` (`prisma migrate deploy`) |
| `deploy/pf_deploy.sh` | código → banco de pé → imagens → migrations → subir → saúde → crons. Saída 0 / 3 (abortou antes de trocar) / outro |
| `deploy/pf_auto_deploy.sh` | cron a cada 15 min: deploy quando o branch remoto avança |
| `deploy/pf_backup.sh` | cron 03:30: `pg_dump` + `.env` + commit, guarda 14 dias |
| `deploy/pf_restore.sh` | `--ensaio` (cron domingo 04:30, Postgres descartável) e `--valendo` (pede RESTAURAR) |
| `deploy/env.exemplo` | modelo do `.env` (só nomes) |
| `deploy/segredos/tunel_token` | token do túnel (fora do git; o compose lê como *secret*) |

### Convivência com o Hash no mesmo VPS
- Projeto Docker, rede, volume do banco, `.env`, túnel e marcas no `$HOME` são **só do PixelFinance**.
- Crontab: as linhas do PixelFinance terminam em `#pixelfinance` e só elas são reescritas pelo
  `pf_deploy.sh`. Os scripts se chamam `pf_*.sh` porque o `deploy.sh` do Hash apaga do crontab
  qualquer linha com `deploy/backup.sh`, `deploy/restore.sh --ensaio` ou `deploy/auto_deploy.sh`.
- Horários deslocados dos do Hash (backup 03:30 × 03:00; ensaio 04:30 × 04:00).

## Instalação (uma vez) — plano para aprovação do dono

1. **Acesso**: aprovar o login do Tailscale SSH no `hash-prod` (modo "check").
2. **Conferir a máquina** (só leitura): memória, disco e containers do Hash.
3. **Cloudflare** (no painel, pelo dono): criar o túnel `pixelfinance` com o hostname do app
   apontando para `http://app:3000`, e o app do Access com as regras de quem entra.
   O token do túnel vai para `deploy/segredos/tunel_token`. A AUD vai para `ACCESS_AUD`.
4. **R2** (pelo dono): bucket + chave restrita ao bucket + CORS para o hostname do app.
5. **Código**: `git clone` em `~/pixelfinance` (branch da homologação), `.env` a partir de
   `deploy/env.exemplo` (senhas geradas no VPS, nunca no chat).
6. **Primeiro deploy**: `bash deploy/pf_deploy.sh` (banco nasce vazio pelas migrations).
7. **Dados**: importar cadastro + categorizações + transações de planilha do banco antigo
   (script de importação, com token só leitura da Turso) e ressincronizar com os bancos.
8. **Homologação** pela equipe no endereço novo; só depois a virada (DNS/Access e fim da Vercel).

## Dia a dia
- Deploy à mão: `cd ~/pixelfinance && bash deploy/pf_deploy.sh`.
- Logs: `docker compose logs -f app`, `~/pixelfinance-deploy-auto.log`, `~/backups/pixelfinance/*.log`.
- Depois de uma saída 3, **não** rode `docker compose up -d` à mão (imagens novas × banco velho).
- Saúde: `docker compose exec app wget -qO- http://127.0.0.1:3000/api/health`.

## Separar para outro VPS (roteiro de ~1 hora)
1. VPS novo com Docker e Tailscale (o `provision.sh` do Hash serve de base).
2. `git clone` do repositório e cópia do `.env` e de `deploy/segredos/tunel_token`.
3. No VPS antigo: `bash deploy/pf_backup.sh`; copie a pasta do backup para o novo.
4. No novo: `docker compose up -d postgres` e `bash deploy/pf_restore.sh --valendo <pasta>`.
5. No novo: `bash deploy/pf_deploy.sh`. O túnel é o mesmo (mesmo token): o endereço não muda.
6. No antigo: `docker compose --profile producao down` e remova as linhas `#pixelfinance` do crontab.
