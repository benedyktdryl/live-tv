FROM oven/bun:1.2-alpine AS base
WORKDIR /app

# Copy all workspace manifests so bun can resolve the full workspace graph
# and the frozen-lockfile check passes (bun needs all package.json files).
COPY package.json bun.lock* ./
COPY packages/core/package.json packages/core/
COPY packages/addon/package.json packages/addon/
COPY packages/cli/package.json packages/cli/
RUN bun install --frozen-lockfile --production

# Copy source
COPY tsconfig.json ./
COPY packages/core/src packages/core/src
COPY packages/addon/src packages/addon/src

EXPOSE 7000

CMD ["bun", "packages/addon/src/index.ts"]
