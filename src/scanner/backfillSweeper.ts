import type { FastifyBaseLogger } from "fastify";
import type { GexClient } from "../gex/client";
import { prisma } from "../db/client";
import { processMatch } from "../pipeline/processMatch";

const PAGE_SIZE = 100; // gex caps `limit` at 100 server-side

/**
 * One backfill sweep: derive the cursor from MIN(startTime) already in the DB, fetch the
 * next page strictly at-or-before it, and process each summary sequentially (matching
 * gex's 1-concurrent-request limit — processMatch's internal gex.getGameEvent call
 * already goes through the shared rate limiter, so this loop just needs to not fire
 * requests in parallel, which `for...of` with `await` guarantees).
 */
export async function runBackfillSweep(gex: GexClient, log: FastifyBaseLogger): Promise<void> {
  const oldest = await prisma.match.aggregate({ _min: { startTime: true } });
  // Undefined on the very first-ever sweep (empty table) — omitting startTimeBefore
  // correctly starts the walk from "now".
  const startTimeBefore = oldest._min.startTime?.toISOString();

  const summaries = await gex.searchMatches({ limit: PAGE_SIZE, startTimeBefore });

  if (summaries.length === 0) {
    log.info("[backfill] empty page — likely reached the start of gex's history");
    return;
  }

  const counts = { inserted: 0, notProcessedYet: 0, insufficientData: 0, alreadyExists: 0 };

  for (const summary of summaries) {
    try {
      const result = await processMatch(gex, summary);
      counts[result]++;
    } catch (err) {
      // One bad match shouldn't kill the sweep — same resilience as matchData.js's
      // fetchLiveMatches loop.
      log.error({ err, matchId: summary.id }, "[backfill] failed to process match");
    }
  }

  log.info({ ...counts, swept: summaries.length }, "[backfill] sweep complete");
}