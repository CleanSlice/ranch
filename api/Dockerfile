FROM oven/bun:1 AS builder
WORKDIR /usr/src/app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bunx prisma generate --schema=./prisma/schema.prisma
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/prisma ./prisma
COPY --from=builder /usr/src/app/package.json ./
ENV PORT=3333
EXPOSE 3333
CMD ["bun", "run", "start:prod"]
