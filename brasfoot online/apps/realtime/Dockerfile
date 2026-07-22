# Build from the monorepo root: docker build -f apps/realtime/Dockerfile .
FROM node:20-slim

# Prisma's query engine dynamically links against OpenSSL — node:20-slim
# doesn't ship it, so without this the engine silently guesses a version
# at `generate` time and can fail to connect to Postgres at runtime.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/realtime/package.json apps/realtime/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/football-data-adapter/package.json packages/football-data-adapter/package.json

RUN npm ci

COPY packages/db packages/db
COPY packages/shared-types packages/shared-types
COPY packages/football-data-adapter packages/football-data-adapter
COPY apps/realtime apps/realtime

RUN npx prisma generate --schema packages/db/prisma/schema.prisma

ENV NODE_ENV=production
EXPOSE 4001

# Invoke tsx directly (not `npm run`) — see apps/api/Dockerfile for why:
# npm as PID 1 swallows SIGTERM instead of forwarding it to the process
# that actually has the graceful-shutdown handler.
CMD ["node_modules/.bin/tsx", "apps/realtime/src/index.ts"]
