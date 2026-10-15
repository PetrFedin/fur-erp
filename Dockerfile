FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Демо-стенд для внешних: DEMO_BUILD=true заменяет вшитые в приложение реальные справочные JSON пустыми заготовками и обезличивает
# реквизиты, фамилии, Word-шаблоны и примеры расчётов в коде (scripts/demo-static-data.mjs → scripts/demo-sanitize.mjs).
ARG DEMO_BUILD=false
ENV DEMO_BUILD=$DEMO_BUILD
ENV NEXT_PUBLIC_DEMO_BUILD=$DEMO_BUILD
ENV NEXT_TELEMETRY_DISABLED=1
RUN if [ "$DEMO_BUILD" = "true" ]; then node scripts/demo-static-data.mjs; fi
RUN npx prisma generate
RUN npm run build
# Метка демо-сборки: демо-контейнер без неё не стартует (защита от случайной выдачи сборки с реальными справочниками).
RUN if [ "$DEMO_BUILD" = "true" ]; then touch .next/standalone/.demo-build; fi

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
# Full node_modules (not just the standalone trace) so the Prisma CLI and its
# transitive deps are available to run migrations on container start.
COPY --from=deps /app/node_modules ./node_modules
# Overlay the generated client (created in the builder stage, after `prisma generate`).
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY docker-entrypoint.sh ./docker-entrypoint.sh
# Upload directory (fitting photos); mount a volume here so files survive redeploys.
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000

ENTRYPOINT ["./docker-entrypoint.sh"]

# Демо-стенд для внешних тестировщиков (ghcr.io + Render): приложение + общий замок Basic Auth в одном контейнере.
# Собирается Render по render.yaml (DEMO_BUILD=true). Это последняя стадия, то есть цель по умолчанию.
# Обычная сборка (docker compose) берёт цель runner явно (target: runner).
FROM runner AS demo
USER root
# Клиент PostgreSQL нужен для первичной загрузки вшитого демо-дампа (deploy/demo/demo.sql.gz).
RUN apk add --no-cache postgresql-client
COPY --chown=nextjs:nodejs deploy/demo-start.mjs ./deploy/demo-start.mjs
COPY --chown=nextjs:nodejs deploy/demo/demo.sql.gz ./deploy/demo/demo.sql.gz
RUN mkdir -p /tmp/uploads && chown nextjs:nodejs /tmp/uploads
ENV PORT=10000 \
    NODE_ENV=production \
    AUTH_TRUST_HOST=true \
    ALLOW_REGISTRATION=false \
    ALLOW_DEMO_LOGIN=false \
    ALLOW_ROLE_SWITCH=false \
    UPLOAD_DIR=/tmp/uploads \
    NODE_OPTIONS=--max-old-space-size=192
USER nextjs
EXPOSE 10000
ENTRYPOINT ["node", "deploy/demo-start.mjs"]
