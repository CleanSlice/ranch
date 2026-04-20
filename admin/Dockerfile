FROM oven/bun:1 AS builder
WORKDIR /usr/src/app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
ARG API_URL
# Skip prebuild (openapi-ts) — SDK is pre-generated under slices/setup/api/data/.
# Invoke nuxt directly to bypass the npm lifecycle hook.
RUN API_URL=${API_URL} bunx nuxt build

FROM node:22-slim
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/.output ./.output
ENV NITRO_PORT=3002
EXPOSE 3002
CMD ["node", ".output/server/index.mjs"]
