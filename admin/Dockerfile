# Build context = monorepo root (need access to api/ for swagger-spec.json).
# In CI: docker build -f admin/Dockerfile .

FROM oven/bun:1 AS api-swagger
WORKDIR /build/api
COPY api/package.json api/bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY api/ ./
RUN bunx prisma-import --force \
 && bunx prisma generate --schema=./prisma/schema.prisma \
 && bun run build \
 && bun run generate:swagger

FROM oven/bun:1 AS admin-builder
WORKDIR /build
COPY --from=api-swagger /build/api/swagger-spec.json ./api/swagger-spec.json
COPY admin/package.json admin/bun.lock* ./admin/
WORKDIR /build/admin
RUN bun install --frozen-lockfile
COPY admin/ ./
ARG API_URL
RUN API_URL=${API_URL} bun run build

FROM node:22-slim
WORKDIR /usr/src/app
COPY --from=admin-builder /build/admin/.output ./.output
ENV NITRO_PORT=3002
EXPOSE 3002
CMD ["node", ".output/server/index.mjs"]
