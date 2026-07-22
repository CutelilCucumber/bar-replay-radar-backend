import { prisma } from "./client";

/**
 * Given a page of match ids from a gex search, returns only the ones NOT already in
 * the DB — one round trip instead of per-match findUnique calls. Used by both sweepers
 * BEFORE spending any rate-limited gex.getGameEvent calls, so already-known matches
 * never cost an API request at all.
 *
 * processMatch's own findUnique check still exists and stays — it's the last line of
 * defense against the (much smaller, now-rarer) race between the two sweepers
 * concurrently reaching a match that's new to BOTH of them.
 */
export async function filterUnknownMatchIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const existing = await prisma.match.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((m) => m.id));
  return ids.filter((id) => !existingIds.has(id));
}