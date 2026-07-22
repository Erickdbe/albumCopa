# Build from the monorepo root: docker build -f apps/worker/Dockerfile .
FROM node:20-slim

# Prisma's query engine dynamically links against OpenSSL — node:20-slim
# doesn't ship it, so without this the engine silently guesses a version
# at `generate` time and can fail to connect to Postgres at runtime.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/football-data-adapter/package.json packages/football-data-adapter/package.json
COPY packages/simulation-engine/package.json packages/simulation-engine/package.json

RUN npm ci

COPY packages/db packages/db
COPY packages/shared-types packages/shared-types
COPY packages/football-data-adapter packages/football-data-adapter
COPY packages/simulation-engine packages/simulation-engine
COPY apps/worker apps/worker

RUN npx prisma generate --schema packages/db/prisma/schema.prisma

ENV NODE_ENV=production

# No port to expose — this process only consumes BullMQ jobs / polls the DB.
# Invoke tsx directly (not `npm run`) — npm as PID 1 doesn't forward
# SIGTERM reliably, which would skip the graceful-shutdown handler in
# src/index.ts (in-flight job draining, closing Redis/Prisma cleanly).
CMD ["node_modules/.bin/tsx", "apps/worker/src/index.ts"]
