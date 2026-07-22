# Build from the monorepo root: docker build -f apps/api/Dockerfile .
# (needs the root as context so npm workspaces / sibling packages resolve)
FROM node:20-slim

# Prisma's query engine dynamically links against OpenSSL — node:20-slim
# doesn't ship it, so without this the engine silently guesses a version
# at `generate` time and can fail to connect to Postgres at runtime.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests first, for layer caching — only re-runs `npm ci` when a
# package.json actually changes, not on every source edit.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/football-data-adapter/package.json packages/football-data-adapter/package.json

RUN npm ci

COPY packages/db packages/db
COPY packages/shared-types packages/shared-types
COPY packages/football-data-adapter packages/football-data-adapter
COPY apps/api apps/api

# Generates packages/db/generated/client — gitignored, must exist before
# the app can import @brfut/db. Run migrations separately (`prisma migrate
# deploy`), not automatically here — multiple replicas migrating at once
# is a race, this only needs the client's TS types + query engine.
RUN npx prisma generate --schema packages/db/prisma/schema.prisma

ENV NODE_ENV=production
EXPOSE 4000

# Invoke tsx directly, not via `npm run` — npm run makes npm PID 1, and
# npm does not reliably forward SIGTERM to its child. That meant the app's
# graceful-shutdown handler (see src/index.ts) never actually ran; `docker
# stop` just killed npm and the process died mid-request instead.
CMD ["node_modules/.bin/tsx", "apps/api/src/index.ts"]
