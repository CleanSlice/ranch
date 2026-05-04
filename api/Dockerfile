# Build context = monorepo root (bun workspace).
# In CI: docker build -f api/Dockerfile .

FROM oven/bun:1 AS builder
WORKDIR /build

# Workspace install — drives api/ deps via the root bun.lock.
COPY package.json bun.lock ./
COPY api/package.json ./api/
COPY app/package.json ./app/
COPY admin/package.json ./admin/
RUN bun install --frozen-lockfile --ignore-scripts

# Build api/
COPY api/ ./api/
WORKDIR /build/api
RUN bunx prisma-import --force \
 && bunx prisma generate --schema=./prisma/schema.prisma \
 && bun run build

# Runtime source + its own deps. Paddock CLI dynamic-imports
# <repo>/runtime/src/runtime.ts at eval time, so we ship the source
# (TypeScript — bun runs it natively) plus its node_modules.
# --ignore-scripts skips heavy postinstalls (playwright browser download).
WORKDIR /build
COPY runtime ./runtime
RUN cd runtime && bun install --frozen-lockfile --ignore-scripts

FROM oven/bun:1-slim
WORKDIR /usr/src/app
COPY --from=builder /build/api/dist ./dist
# Workspace deps are hoisted to /build/node_modules; api/node_modules
# only carries symlinks. Copy the hoisted store so node resolution
# from /usr/src/app/dist works.
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/api/prisma ./prisma
COPY --from=builder /build/api/package.json ./
# Runtime sits at /usr/src/app/runtime — picked up by BunCliPaddockRunner
# via PADDOCK_RUNTIME_ROOT (set in k8s) or auto-detection (`process.cwd() + '/runtime'`).
COPY --from=builder /build/runtime ./runtime
ARG RANCH_VERSION=dev
ENV RANCH_VERSION=${RANCH_VERSION}
ENV PORT=3333
EXPOSE 3333
CMD ["bun", "run", "start:prod"]
