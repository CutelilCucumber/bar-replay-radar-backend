import type { FastifyBaseLogger } from "fastify";
import type { GexClient } from "../gex/client";
import { filterUnknownMatchIds } from "../db/queries";
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
  let skippedAlreadyKnown = 0;
  let offset = 0;

  for (;;) {
    const summaries = await gex.searchMatches({ limit: PAGE_SIZE, offset });
    if (summaries.length === 0) break; // exhausted all results

    // Results are ordered desc by start_time: split this page at the first match older
    // than the window — everything from that point on (this page and all further ones)
    // is out of range and gets skipped entirely, without ever being DB-checked.
    const cutoffIndex = summaries.findIndex((s) => new Date(s.startTime).getTime() < cutoffMs);
    const inWindow = cutoffIndex === -1 ? summaries : summaries.slice(0, cutoffIndex);

    // Bulk-check the in-window subset BEFORE spending any rate-limited getGameEvent
    // calls — this is what actually stops re-fetching matches the recent sweeper has
    // already picked up in an earlier run.
    const idsToProcess = await filterUnknownMatchIds(inWindow.map((s) => s.id));
    skippedAlreadyKnown += inWindow.length - idsToProcess.length;
    const idSet = new Set(idsToProcess);

    for (const summary of inWindow) {
      if (!idSet.has(summary.id)) continue;
      try {
        const result = await processMatch(gex, summary);
        counts[result]++;
      } catch (err) {
        log.error({ err, matchId: summary.id }, "[recent] failed to process match");
      }
    }

    if (cutoffIndex !== -1) {
      log.info(
        { ...counts, skippedAlreadyKnown, reason: "reached lookback window" },
        "[recent] sweep complete",
      );
      return;
    }

    if (summaries.length < PAGE_SIZE) break; // last page
    offset += PAGE_SIZE;
  }

  log.info(
    { ...counts, skippedAlreadyKnown, reason: "exhausted results" },
    "[recent] sweep complete",
  );
}