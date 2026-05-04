FROM oven/bun:1.2-alpine AS base
WORKDIR /app

# Install dependencies first (layer cache-friendly)
COPY package.json bun.lock* ./
COPY packages/core/package.json packages/core/
COPY packages/addon/package.json packages/addon/
RUN bun install --frozen-lockfile --production

# Copy source
COPY tsconfig.json ./
COPY packages/core/src packages/core/src
COPY packages/addon/src packages/addon/src

EXPOSE 7000

CMD ["bun", "packages/addon/src/index.ts"]
