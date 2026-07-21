import type { FastifyBaseLogger } from "fastify";
import type { GexClient } from "../gex/client";
import { processMatch } from "../pipeline/processMatch";

const PAGE_SIZE = 100;
// 6h run cadence + 1h overlap margin, so a match still "processing" (204) at the tail
// end of one run gets a full cycle to be caught by the next, rather than a hard edge.
const LOOKBACK_HOURS = 7;

/**
 * One recent sweep: walks forward through offset-paged results from "now" until either
 * a page's results run out, or a match older than the lookback window is reached.
 * Offset-paging drifts against a live, growing result set in general (see earlier
 * discussion) — but that drift only matters over a long walk. This sweeper only ever
 * covers a shallow, recent window each run, so any drift is corrected by the next run
 * a few hours later, same as gaps and 204-retries are.
 */
export async function runRecentSweep(gex: GexClient, log: FastifyBaseLogger): Promise<void> {
  const cutoffMs = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000;
  const counts = { inserted: 0, notProcessedYet: 0, insufficientData: 0, alreadyExists: 0 };
  let offset = 0;

  for (;;) {
    const summaries = await gex.searchMatches({ limit: PAGE_SIZE, offset });
    if (summaries.length === 0) break; // exhausted all results

    for (const summary of summaries) {
      if (new Date(summary.startTime).getTime() < cutoffMs) {
        // Results are ordered desc by start_time: once one match is older than the
        // window, every match after it (this page and all further pages) is too.
        log.info({ ...counts, reason: "reached lookback window" }, "[recent] sweep complete");
        return;
      }

      try {
        const result = await processMatch(gex, summary);
        counts[result]++;
      } catch (err) {
        log.error({ err, matchId: summary.id }, "[recent] failed to process match");
      }
    }

    if (summaries.length < PAGE_SIZE) break; // last page
    offset += PAGE_SIZE;
  }

  log.info({ ...counts, reason: "exhausted results" }, "[recent] sweep complete");
}