# API image (NestJS + Socket.IO). Build from the repo root:
#   docker build -f infra/Dockerfile -t qr-api .
# The same image runs migrations: `node_modules/.bin/qr-prisma migrate deploy` (uses DIRECT_DATABASE_URL).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter "@app/api..."
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm --filter @app/shared build && pnpm --filter @app/db build && pnpm --filter @app/api build
# Production-only node_modules for the API, then generate the Prisma client into it.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter @app/api deploy --prod --legacy /out \
 && cd /out && node_modules/.bin/qr-prisma generate

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
