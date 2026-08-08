import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { runBackfillSweep } from "../scanner/backfillSweeper";
import { runRecentSweep } from "../scanner/recentSweeper";

// Must be registered AFTER plugins/gexClient.ts — this plugin reads fastify.gex,
// which only exists once that decorator has run.
export default fp(async function scannerPlugin(fastify: FastifyInstance) {
  let stopping = false;
  let backfillTimer: NodeJS.Timeout | undefined;
  let recentTimer: NodeJS.Timeout | undefined;

  // Schedules alternate to prevent concurrent requests (per gex's api docs)
  async function scheduleBackfill(): Promise<void> {
    if (stopping) return;
    try {
      await runBackfillSweep(fastify.gex, fastify.log);
    } catch (err) {
      fastify.log.error({ err }, "[backfill] sweep threw");
    }
    if (!stopping) backfillTimer = setTimeout(scheduleRecent);
  }

  async function scheduleRecent(): Promise<void> {
    if (stopping) return;
    try {
      await runRecentSweep(fastify.gex, fastify.log);
    } catch (err) {
      fastify.log.error({ err }, "[recent] sweep threw");
    }
    if (!stopping) recentTimer = setTimeout(scheduleBackfill);
  }

  fastify.addHook("onReady", async () => {
    // Deliberately not awaited: the loop runs forever, and onReady awaiting them
    // directly would block the server from ever accepting HTTP traffic.
    void scheduleRecent();
  });

  fastify.addHook("onClose", async () => {
    // Stops SCHEDULING further sweeps. Does not abort a sweep already in-flight — its
    // current await (a single gex fetch, rate-limited to one at a time) is left to
    // finish naturally rather than being killed mid-request.
    stopping = true;
    if (backfillTimer) clearTimeout(backfillTimer);
    if (recentTimer) clearTimeout(recentTimer);
  });
});