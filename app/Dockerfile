FROM oven/bun:1 AS builder
WORKDIR /usr/src/app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
ARG API_URL
RUN API_URL=${API_URL} bun run build

FROM node:22-alpine
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/.output ./.output
EXPOSE 3002
CMD ["node", ".output/server/index.mjs"]
