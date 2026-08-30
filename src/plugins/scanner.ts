import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { runBackfillSweep } from "../scanner/backfillSweeper";
import { runRecentSweep } from "../scanner/recentSweeper";

const BACKFILL_INTERVAL_MS = 0;
const RECENT_INTERVAL_MS = 6 * 60 * 60 * 1000; //6 hrs

const ENABLE_BACKFILL = process.env.ENABLE_BACKFILL !== "false";
const ENABLE_RECENT_SWEEPER = process.env.ENABLE_RECENT_SWEEPER !== "false";

// Must be registered AFTER plugins/gexClient.ts — this plugin reads fastify.gex,
// which only exists once that decorator has run.
export default fp(async function scannerPlugin(fastify: FastifyInstance) {
  let stopping = false;
  let backfillTimer: NodeJS.Timeout | undefined;
  let recentTimer: NodeJS.Timeout | undefined;

  // Recursive scheduling, deliberately NOT setInterval: a sweep can take well over 5s
  // (each fetch inside it is rate-limited to ~1/sec), so setInterval would stack
  // overlapping sweeps against the same rate limiter and DB. Scheduling the next run
  // only after the current one's `await` fully resolves guarantees they never overlap.
  async function scheduleBackfill(): Promise<void> {
    if (stopping) return;
    try {
      await runBackfillSweep(fastify.gex, fastify.log);
    } catch (err) {
      fastify.log.error({ err }, "[backfill] sweep threw");
    }
    if (!stopping) backfillTimer = setTimeout(scheduleBackfill, BACKFILL_INTERVAL_MS);
  }

  async function scheduleRecent(): Promise<void> {
    if (stopping) return;
    try {
      await runRecentSweep(fastify.gex, fastify.log);
    } catch (err) {
      fastify.log.error({ err }, "[recent] sweep threw");
    }
    if (!stopping) recentTimer = setTimeout(scheduleRecent, RECENT_INTERVAL_MS);
  }

  fastify.addHook("onReady", async () => {
    // Backfill is disabled on deployment to preserve supabase's limited disk space
    // TODO: make a permanent solution to limited disk space
    if (ENABLE_BACKFILL) {
      void scheduleBackfill();
    }
    if (ENABLE_RECENT_SWEEPER) {
      void scheduleRecent();
    }
  });

  fastify.addHook("onClose", async () => {
    // Stops SCHEDULING further sweeps. Does not abort a sweep already in-flight — its
    // current await (a single gex fetch, rate-limited to one at a time) is left to
    // finish naturally rather than being killed mid-request, per the migration plan.
    stopping = true;
    if (backfillTimer) clearTimeout(backfillTimer);
    if (recentTimer) clearTimeout(recentTimer);
  });
});