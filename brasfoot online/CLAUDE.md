# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

BrFut is a multiplayer, real-time football (soccer) management game inspired by Brasfoot, but simulated live instead of single-player/offline. Users manage clubs, matches are simulated automatically and broadcast live over WebSockets, and clubs compete in leagues with a transfer market.

npm workspaces monorepo: `apps/*` (deployable processes) + `packages/*` (shared libraries). Node >=20, TypeScript everywhere, ESM (`NodeNext` module resolution — relative imports use `.js` extensions even though the source is `.ts`).

## Commands

### Local infra
```bash
docker compose -f infra/docker-compose.yml up -d   # Postgres (5433->5432) + Redis (6379)
```
Postgres is mapped to host port **5433**, not 5432 — avoids colliding with any other local Postgres. Each app needs its own `.env` (copy from that app's `.env.example`); there's no shared root `.env`.

### Database (packages/db)
```bash
npm run db:migrate   # from root: prisma migrate dev (interactive)
npm run db:seed      # from root: seeds a league — real clubs if FOOTBALL_DATA_API_KEY is set, fictional otherwise
```
`prisma migrate dev` requires an interactive TTY and **fails in non-interactive shells/CI**. When scripting a migration non-interactively, use this sequence instead:
```bash
npx prisma migrate diff --from-url "<DATABASE_URL>" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql
npx prisma migrate deploy
npx prisma generate
```
On Windows, `prisma generate` fails with `EPERM` if any running dev process (api/worker/realtime) has the query engine DLL loaded — stop those processes first, generate, then restart them.

### Running services (each is a separate process, run whichever you need)
```bash
npm run dev:api        # Express API      :4000
npm run dev:worker      # BullMQ worker + pollers (no port)
npm run dev:realtime    # Socket.io gateway :4001
npm run dev:web         # Vite dev server   :5173
```
Manually trigger a simulation for the oldest `SCHEDULED` match (useful since there's no round/schedule generator yet):
```bash
npm run trigger-match -w @brfut/worker
```

### Tests
```bash
npm run test -w @brfut/simulation-engine        # vitest — determinism + balance-sanity tests
npm run test -w @brfut/football-data-adapter    # vitest — attribute generator tests
```
No tests exist yet for `apps/*` — verification so far has been manual (curl / Playwright against a running stack).

### Build / typecheck
```bash
npm run build                                    # build --workspaces --if-present
npx tsc -p <apps|packages>/<name>/tsconfig.json --noEmit   # typecheck a single package
```

### Docker / production build
```bash
docker build -f apps/api/Dockerfile .            # build context is the repo ROOT, not apps/api
docker compose -f docker-compose.prod.yml up -d --build   # full stack; needs real env vars, see file header
```
See "Deploy / Production" below before touching these — there are a couple of non-obvious gotchas (signal handling, OpenSSL) already fixed there that are easy to accidentally reintroduce.

## Architecture

### The core idea: simulate once, replay over time
A match is **simulated synchronously and entirely in one pass** by `packages/simulation-engine` (deterministic given `Match.simulationSeed` — same seed always produces the same event log). The worker (`apps/worker`) runs this simulation, persists the full result, then publishes the ordered event log to a Redis Stream (`match:{id}:events`). The realtime gateway (`apps/realtime`) is a *separate concern*: it reads that stream and paces emission to spectators at the league's `playbackSecondsPerMinute`, entirely independent of when the simulation actually ran. **The gateway never simulates anything** — if you're debugging "why don't live events look right," check the worker's event generation, not the gateway's pacing logic (`apps/realtime/src/matchBroadcaster.ts`).

`Match.status` only ever moves `SCHEDULED -> FINISHED` (set directly by the worker). It does **not** track "currently broadcasting" — the realtime gateway tracks that itself in an in-memory map (`apps/realtime/src/matchBroadcaster.ts`), populated by a poller (`apps/realtime/src/poller.ts`) that picks up newly-`FINISHED` matches. This in-memory broadcast state does not survive a gateway restart or scale across multiple gateway instances — a known limitation, not a bug.

### Package/app dependency direction
- `packages/shared-types` — pure types + deterministic RNG utilities (`createRng`/`hashStringToSeed`, seeded so simulation and player evolution are reproducible) + `calculateOverall` (the **single source of truth** for "which attributes count toward a player's overall, per position" — used both by player generation and by post-match evolution; don't reimplement this elsewhere).
- `packages/football-data-adapter` — fetches team/player *identity* from football-data.org and generates gameplay attributes (no public football API exposes FIFA-style ratings, so attributes are always generated, never imported).
- `packages/simulation-engine` — the match engine. No dependency on Express/Prisma/Socket.io; pure function `simulateMatch(homeTeam, awayTeam, seed) -> MatchResult`.
- `packages/db` — Prisma client + schema + shared cross-app business logic that needs direct DB access from more than one app: `market.ts` (`resolveListingSale`, used by both the API's buy-now path and the worker's expiry sweep), `leagueSetup.ts` (`createLeagueWithClubs`, used by both the CLI seed and the API's room-creation endpoint), `fallbackPlayers.ts` (fictional squad generation, including `fillMissingSquads` — see gotcha below).
- Apps depend on packages, never the other way; apps don't import each other.

### Known external API gotcha
football-data.org's **free tier returns `squad: []` for every team**, on both the competition-list and team-detail endpoints (confirmed against the live API — this isn't a bug in the adapter). Real club identity (name, country, venue) comes through fine; player data does not. `packages/db/src/fallbackPlayers.ts`'s `fillMissingSquads` backfills a generated fictional squad for any club the API returns with zero players, keeping the real club name. Both the CLI seed and the "create private room" API endpoint rely on this — don't assume `importCompetition()` alone gives you playable clubs.

### Realtime/worker patterns worth reusing
- **Atomic conditional-update guard**: for any "only one of these concurrent requests should win" scenario (claiming a club, placing a market bid), the pattern is a single `updateMany({ where: { id, <still-in-the-expected-state> }, data: {...} })` and checking `result.count`, rather than a racy read-then-write. See `apps/api/src/routes/clubs.ts` (claim) and `apps/api/src/routes/market.ts` (bids) for the two existing examples.
- **Time-based sweeps use `setInterval` pollers, not BullMQ jobs** — BullMQ is for discrete, triggered work (`simulate-match`). Anything that needs to notice "some deadline has passed" (match-finished-so-start-broadcasting in `apps/realtime/src/poller.ts`; listing-expired in `apps/worker/src/marketResolver.ts`) is a poller instead, since nothing "enqueues" the passage of time.
- **Express 4 does not catch rejected promises from async route handlers or async middleware.** Every route handler and every custom middleware must be wrapped in `apps/api/src/middleware/asyncHandler.ts`. This was verified the hard way: an unhandled rejection from a transient DB error took down the *entire* API process, not just the one request. `apps/api/src/middleware/errorHandler.ts` is the global handler that turns caught errors into safe JSON responses.

### Auth & authorization
JWT (`apps/api/src/auth/`), bcrypt password hashing, algorithm pinned on verify (`HS256` explicitly, not inferred). `requireAuth` populates `req.user`; `requireClubOwner` (`apps/api/src/middleware/requireClubOwner.ts`) additionally loads and attaches `req.club`, checking `club.userId === req.user.sub`. A user owns **at most one club**, enforced by a DB-level `@unique` constraint on `Club.userId` (not an app-level check) — Postgres treats multiple `NULL`s as non-conflicting, so unclaimed clubs (`userId: null`) are unaffected.

### Leagues: public vs. private rooms
`League.isPrivate` + `League.ownerId`. `GET /leagues` only lists public ones; `GET /leagues/:id` intentionally does **not** filter by `isPrivate` — a private room's ID *is* its invite link. `POST /leagues` (the "create private room" flow) always creates `isPrivate: true`.

### Player development
There's no separate calendar/season-tick system. Player evolution (`apps/worker/src/playerEvolution.ts`) is triggered once per simulated match, for the 22 players who started it. Young players (<24) occasionally tick one specialty attribute toward their `potential`; veterans (31+) occasionally tick one down. Seeded by `matchId:playerId` for determinism. Note: individual attributes can already sit above a player's whole-player `potential` (potential is a derived average) — growth must never pull an above-ceiling attribute back down, only stop it climbing further.

## Deploy / Production

Each app has a `Dockerfile` (build context is the **monorepo root**, not the app directory — `docker build -f apps/api/Dockerfile .`), and `docker-compose.prod.yml` at the repo root wires all four images together with Postgres/Redis. All required env vars in that compose file use `${VAR:?message}` so `docker compose up` fails immediately with a clear message if a real value hasn't been supplied — nothing silently falls back to the dev defaults from `.env.example`.

Two non-obvious things worth knowing before touching the Dockerfiles or debugging a container that won't shut down cleanly:

- **CMD invokes `tsx` directly (`node_modules/.bin/tsx apps/api/src/index.ts`), never `npm run start`.** Verified the hard way: when the container's CMD is `npm run start -w @brfut/api`, `npm` — not the app — is PID 1, and npm does not reliably forward `SIGTERM` to its child. `docker stop` killed the process mid-request instead of running the graceful-shutdown handler at all. Every app's `src/index.ts` has a `SIGTERM`/`SIGINT` handler (closes the HTTP server / BullMQ workers / Socket.io + Redis connections before exiting) — it only runs if the container's PID 1 is the actual Node process.
- **`node:20-slim` needs OpenSSL installed explicitly** (`apt-get install -y openssl` in each backend Dockerfile) — Prisma's query engine links against it dynamically, and without it `prisma generate` guesses a version that may not match what's actually available at runtime, breaking the DB connection silently.
- `apps/web`'s Dockerfile bakes `VITE_API_URL`/`VITE_REALTIME_URL` in as **build args**, not runtime env vars — Vite inlines `import.meta.env.VITE_*` into the static bundle at build time. Changing them means rebuilding the image, not restarting the container.
- `apps/api/src/assertProductionConfig.ts` runs at boot and refuses to start (throws, crashing the process on purpose) if `NODE_ENV=production` and `JWT_SECRET` is still the dev default or under 32 chars — catches the single most common real deploy mistake before it ships.
- Migrations are **not** run automatically by any container — run `prisma migrate deploy` as a one-off (`docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`) after the first `up`, per the comment at the top of that compose file. Auto-migrating on every container boot is a race when there's more than one replica.
- Rate limiting is layered: `apps/api/src/middleware/apiRateLimit.ts` has a generous baseline (`apiRateLimit`, applied globally after `/health` so orchestrator health checks are never throttled) plus stricter per-endpoint limits (`loginRateLimit`/`registerRateLimit` in `authRateLimit.ts`, `createRoomRateLimit` on `POST /leagues` specifically because that endpoint calls out to football-data.org's shared-quota API key).

**Still missing for a real production deploy** (this pass only made the app *dockerizable*, it didn't choose or configure a host): TLS termination, a real secrets manager (the compose file expects real values via env, but doesn't fetch them from anywhere), CI/CD, log aggregation/monitoring, and a backup policy for Postgres. `apps/realtime`'s in-memory broadcast state (see above) also means running more than one replica of it isn't safe yet without moving that state into Redis.

## Current gaps (not yet built, come up often)
- No round-robin/schedule generator — matches only exist if manually created (CLI seed creates one demo match per league; nothing generates a full fixture list).
- No direct point-to-point transfer negotiation (offer/accept/reject) — only the auction side of the market (`TransferListing` + `Bid`) is implemented. The `process-transfer` BullMQ queue in `apps/worker/src/index.ts` is reserved for this but has no processor.
- No user-controlled starting lineup — the worker auto-picks the best 11 by overall (`apps/worker/src/jobs/simulateMatch.ts`'s `buildTeamInput`).
