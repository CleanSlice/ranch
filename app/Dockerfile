# Build context = monorepo root (need access to api/ for swagger-spec.json).
# In CI: docker build -f app/Dockerfile .

# Stage 1: build API just to generate swagger-spec.json
FROM oven/bun:1 AS api-swagger
WORKDIR /build/api
COPY api/package.json api/bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY api/ ./
RUN bunx prisma-import --force \
 && bunx prisma generate --schema=./prisma/schema.prisma \
 && bun run build \
 && bun run generate:swagger

# Stage 2: build Nuxt app, consuming the generated swagger from stage 1
FROM oven/bun:1 AS app-builder
WORKDIR /build
COPY --from=api-swagger /build/api/swagger-spec.json ./api/swagger-spec.json
COPY app/package.json app/bun.lock* ./app/
WORKDIR /build/app
RUN bun install --frozen-lockfile
COPY app/ ./
ARG API_URL
RUN API_URL=${API_URL} bun run build

# Stage 3: runtime
FROM node:22-alpine
WORKDIR /usr/src/app
COPY --from=app-builder /build/app/.output ./.output
ENV NITRO_PORT=3002
EXPOSE 3002
CMD ["node", ".output/server/index.mjs"]
