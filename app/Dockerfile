# Build context = monorepo root (bun workspace + need access to api/ for swagger).
# In CI: docker build -f app/Dockerfile .

# Stage 1: build API just to generate swagger-spec.json
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

# Stage 2: build Nuxt app, consuming the generated swagger from stage 1
FROM oven/bun:1 AS app-builder
WORKDIR /build
COPY package.json bun.lock ./
COPY api/package.json ./api/
COPY app/package.json ./app/
COPY admin/package.json ./admin/
RUN bun install --frozen-lockfile
COPY --from=api-swagger /build/api/swagger-spec.json ./api/swagger-spec.json
COPY app/ ./app/
WORKDIR /build/app
ARG API_URL
ARG RANCH_VERSION=dev
RUN API_URL=${API_URL} RANCH_VERSION=${RANCH_VERSION} bun run build

# Stage 3: runtime
FROM node:22-alpine
WORKDIR /usr/src/app
COPY --from=app-builder /build/app/.output ./.output
ARG RANCH_VERSION=dev
ENV RANCH_VERSION=${RANCH_VERSION}
ENV NITRO_PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
