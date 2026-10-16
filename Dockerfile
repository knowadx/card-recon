# PixelFinance — imagem no padrão do Hash (VPS + Docker). Três alvos:
#   app      → o site (Next standalone), sem código-fonte nem dependências de build
#   migrate  → só aplica as migrations (prisma migrate deploy) e sai
#   (deps/build são etapas internas)
#
# NODE_IMAGE: produção usa o Node 24 (LTS). O teste local pode passar outra imagem já baixada
# (--build-arg NODE_IMAGE=...) quando o Docker Hub não responde.
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# o postinstall roda `prisma generate`: o schema precisa estar aqui antes do npm ci
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# o build não conecta no banco; a URL só precisa existir para o Prisma gerar o cliente
RUN DATABASE_URL="postgresql://build@localhost:5432/build" npm run build

# Migrations: SÓ o Prisma CLI (e o dotenv que o prisma.config.ts importa), nas MESMAS versões
# travadas no package-lock (fonte única) — nada de Next/React/gráficos. O disco do VPS é apertado.
FROM ${NODE_IMAGE} AS migrate
WORKDIR /migrate
COPY package-lock.json /tmp/package-lock.json
RUN set -e; \
    P=$(node -p "require('/tmp/package-lock.json').packages['node_modules/prisma'].version"); \
    D=$(node -p "require('/tmp/package-lock.json').packages['node_modules/dotenv'].version"); \
    echo '{"private":true}' > package.json; \
    npm install --no-audit --no-fund "prisma@$P" "dotenv@$D"; \
    rm /tmp/package-lock.json
COPY prisma.config.ts ./
COPY prisma ./prisma
CMD ["npx", "prisma", "migrate", "deploy"]

FROM ${NODE_IMAGE} AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
