# BAR Match Analyzer — Backend

Continuously scans [gex](https://gex.honu.pw) for Beyond All Reason match data, runs each
match through the milestone-analysis pipeline, and stores results in Postgres so the
frontend can query/filter without hitting gex directly.

## Stack

- **TypeScript** (`tsx` for dev, no build step)
- **Fastify** — HTTP server, plugin-based
- **Prisma 7** (with `@prisma/adapter-pg`) — Postgres ORM, hosted on **Supabase**
- **@fastify/cors** — for the frontend dev server

## Setup

```bash
npm install
cp .env.example .env   # fill in your Supabase connection strings
npx prisma generate    # writes the client to src/generated/prisma
npx prisma migrate dev # applies schema.prisma to your DB
npm run dev             # tsx watch src/server.ts
```

**Two Supabase connection strings are required, and they are not interchangeable:**

| Env var | Port | Used by | Why |
|---|---|---|---|
| `SUPABASE_DATABASE_URL` | 6543 (pooled) | the running app (`src/db/client.ts`) | needs `?pgbouncer=true` appended |
| `SUPABASE_DIRECT_URL` | 5432 (direct) | Prisma CLI only (`prisma.config.ts`) | pgbouncer's transaction pooling can't run migrations |

`prisma.config.ts` and the running app load `.env` independently — the CLI loads it via
`import "dotenv/config"` in `prisma.config.ts` itself, but `src/server.ts` needs the same
import as its own first line, or `process.env` is empty when the app actually starts.

### Optional env vars

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | bind address |
| `ENABLE_BACKFILL` | `true` (unset = on) | set to `"false"` to run with only the recent sweeper — see "Disk space" below |

## Architecture

```
src/
  types/        gex.ts (external API shapes) · domain.ts (our pipeline's own shapes)
  gex/          rate-limited gex API client (client.ts, rateLimiter.ts)
  pipeline/      buildSeries.ts / analyzeMatch.ts — typed wrappers around raw/*.js
    raw/          unmodified pipeline logic ported from the frontend (buildSeries.js,
                   analyzeMatch.js, milestones.js, globalVars.js)
    processMatch.ts   fetch → analyze → insert, the core unit of work
  scanner/      backfillSweeper.ts (walks history backward) · recentSweeper.ts (catches
                gaps/retries near "now")
  db/           client.ts (Prisma singleton) · queries.ts (bulk existence checks)
  plugins/      gexClient.ts (decorates fastify.gex) · scanner.ts (onReady/onClose hooks)
  routes/       matches.ts (GET /matches, POST /matches/:id/analyze)
  app.ts         builds the Fastify instance (no listen — for tests)
  server.ts      actual entry point, starts listening + graceful shutdown
```

### Scanning strategy

Two independent sweepers, both started from `onReady` in `plugins/scanner.ts` and run via recursive `setTimeout`

- **Backfill** (gated by `ENABLE_BACKFILL`) — cursors backward through history
  using `MIN(startTime)` already in the DB as the `startTimeBefore` filter. Never
  revisits a match once it's in the DB.
- **Recent** (every 6h, 7h lookback, always on) — re-walks from "now" back ~7 hours to
  catch matches that were `204` (not yet processed by gex) during backfill's pass, or
  landed after backfill had already moved past that point in time. The 1-hour overlap
  beyond the 6h cadence covers a match still mid-processing at the tail end of one run.

Both bulk-check match ids against the DB (`db/queries.ts`) **before** spending any
rate-limited API call, and both share one `RateLimiter` instance via `fastify.gex`.

### gex API

- 300-request bucket, refills 1/sec, 1 concurrent request — enforced by
  `gex/rateLimiter.ts`, shared across the whole app via `fastify.gex`.
- `GET /api/game-event/{id}` returns **204** if the match hasn't been processed yet.
  Modeled as a discriminated union (`GameEventResult`), not a thrown error — see
  `types/gex.ts`.
- Every `GameOutput` field beyond the id is opt-in via an `include*` query flag —
  and this applies separately to **both** `/api/game-event/{id}` and
  `/api/match/{id}` (the single-match lookup used by the on-demand analyze route).
  They gate different field sets with different flags; a response missing `teamStats`
  from `/api/match/{id}` doesn't mean the match lacks data, it means the right
  `include*` param wasn't passed. Getting this wrong silently produces
  `insufficientData` results for perfectly valid matches — see `gex/client.ts`'s
  `getMatchById` for the params that turned out to be required.
- `unitsCreated` fires on construction **start**, not completion.

## API

### `GET /matches`

Paginated, filtered match list. Query params:

- `limit` (default 100, max 100), `offset`
- `sortBy` (`startTime` | `score` | `durationMinutes`, default `startTime`), `sortDir`
  (`asc` | `desc`, default `desc`)
- `gamemode`
- `playerCountMin`/`Max`, `averageOSMin`/`Max`, `scoreMin`/`Max`,
  `durationMinutesMin`/`Max`
- `startTimeAfter`/`Before` (ISO date-time)
- One boolean param per milestone (e.g. `?stomp=true&comeback=false`) — the full list is
  derived from `pipeline/raw/milestones.js`, not hardcoded in the route

Response: `{ matches: [...], total, limit, offset }`

### `POST /matches/:id/analyze`

On-demand single-match lookup. Checks the DB first; if absent, fetches directly from
gex (`GET /api/match/{id}`, not the search endpoint) and analyzes it.

| Result | Status |
|---|---|
| Already in DB, or newly inserted | 200 / 201 |
| gex has no record of this id | 404 |
| gex hasn't processed it yet | 202 |
| Insufficient data to analyze | 422 |

## Disk space

Supabase's free tier will fill up well before the full match history is backfilled.
Current approach, deploy with `ENABLE_BACKFILL=false` so only the recent sweeper (which
has a small, bounded footprint — a fixed 7h lookback window, not unbounded history)
keeps running. `POST /matches/:id/analyze` remains available as an on-demand fallback
for any older match backfill never reached. Supabase has no built-in "auto-prune when
near full" feature — it just goes read-only at quota, so this has to be managed
proactively rather than reactively.

## TODOs

- `raw/milestones.js` is a hand-maintained, lucide-react-stripped copy of the frontend's
  milestone config — must be kept in sync by hand (key + weight only) whenever the
  frontend's list changes. A stale copy here causes a `NaN` score, not an error — worth
  remembering if scores ever look wrong after a milestone edit.
- `baseRace`, `nonstandard game`, `artistic players`, are possible milestones to build for sorting.
- No automated pruning/retention job yet — see "Disk space" above.
