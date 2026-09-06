#!/usr/bin/env tsx
import { prisma } from "../src/db/client";
import { Prisma } from "../src/generated/prisma/client";

async function main() {
  const isDryRun = !process.argv.includes("--execute");
  const batchSize = 100;

  console.log(`[${new Date().toISOString()}] Starting cleanup (dryRun: ${isDryRun})`);

  // Query matches with malformed/missing position data
  // Criteria:
  // 1. Empty startPositions arrays (teamA or teamB)
  // 2. Null x/z coordinates in startPositions
  // 3. commanderAttack magnitude is null (was NaN)
  const malformedMatches = await prisma.$queryRaw<
    { id: string }[]
  >`
    SELECT id FROM "Match"
    WHERE
      -- Empty startPositions arrays
      jsonb_array_length("teamAFacts"->'startPositions') = 0
      OR jsonb_array_length("teamBFacts"->'startPositions') = 0
      -- Null x/z in startPositions (teamA)
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements("teamAFacts"->'startPositions') elem
        WHERE elem->>'x' IS NULL OR elem->>'z' IS NULL
      )
      -- Null x/z in startPositions (teamB)
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements("teamBFacts"->'startPositions') elem
        WHERE elem->>'x' IS NULL OR elem->>'z' IS NULL
      )
      -- commanderAttack magnitude is null (was NaN)
      OR ("analysis"->'magnitudes'->>'commanderAttack') IS NULL
  `;

  const ids = malformedMatches.map((m) => m.id);
  console.log(`Found ${ids.length} matches with malformed position data`);

  if (ids.length === 0) {
    console.log("Nothing to clean up.");
    return;
  }

  if (isDryRun) {
    console.log("DRY RUN - matches that would be deleted:");
    ids.forEach((id) => console.log(`  ${id}`));
    console.log("\nRe-run with --execute to actually delete.");
    return;
  }

  // Delete in batches
  let deleted = 0;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const result = await prisma.match.deleteMany({
      where: { id: { in: batch } },
    });
    deleted += result.count;
    console.log(`Deleted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(ids.length / batchSize)} (${result.count} matches)`);
  }

  console.log(`[${new Date().toISOString()}] Done. Deleted ${deleted} matches.`);
}

main()
  .catch((e) => {
    console.error("Cleanup failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });