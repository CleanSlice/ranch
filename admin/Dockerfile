# Build context = monorepo root (bun workspace + need access to api/ for swagger).
# In CI: docker build -f admin/Dockerfile .

FROM oven/bun:1 AS api-swagger
WORKDIR /build
COPY package.json bun.lock ./
COPY api/package.json ./api/
COPY app/package.json ./app/
COPY admin/package.json ./admin/
RUN bun install --frozen-lockfile --ignore-scripts
COPY api/ ./api/
WORKDIR /build/api
RUN bunx prisma-import --force \
 && bunx prisma generate --schema=./prisma/schema.prisma \
 && bun run build \
 && bun run generate:swagger

FROM oven/bun:1 AS admin-builder
WORKDIR /build
COPY package.json bun.lock ./
COPY api/package.json ./api/
COPY app/package.json ./app/
COPY admin/package.json ./admin/
RUN bun install --frozen-lockfile
COPY --from=api-swagger /build/api/swagger-spec.json ./api/swagger-spec.json
COPY admin/ ./admin/
WORKDIR /build/admin
ARG API_URL
RUN API_URL=${API_URL} bun run build

FROM node:22-slim
WORKDIR /usr/src/app
COPY --from=admin-builder /build/admin/.output ./.output
ENV NITRO_PORT=3001
EXPOSE 3001
CMD ["node", ".output/server/index.mjs"]
