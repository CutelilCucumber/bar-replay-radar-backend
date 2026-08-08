import { Prisma } from "../generated/prisma/client";
import { prisma } from "../db/client";
import { buildMatchDataset } from "./buildSeries";
import { analyzeMatch } from "./analyzeMatch";
import { GexClient } from "../gex/client";
import type { AllyTeam, MatchSummary, Player } from "../types/gex";
import type { AnalyzableMatch } from "../types/domain";

export type ProcessResult =
  | "inserted"
  | "alreadyExists"
  | "notProcessedYet"
  | "insufficientData";

// --- small pure helpers, ported directly from matchData.js's private functions ---

function getSortedAllyIds(allyTeams: AllyTeam[]): number[] {
  return [...new Set(allyTeams.map((a) => a.allyTeamID))].sort((x, y) => x - y);
}

function getWinnerSide(allyTeams: AllyTeam[], allyIds: number[]): "A" | "B" {
  const winningAlly = allyTeams.find((a) => a.won);
  return winningAlly?.allyTeamID === allyIds[0] ? "A" : "B";
}

function averageSkill(players: Player[], allyId: number): number {
  const teamPlayers = players.filter((p) => p.allyTeamID === allyId);
  if (teamPlayers.length === 0) return 20; // neutral default, matches matchData.js
  const total = teamPlayers.reduce((sum, p) => sum + Number(p.skill ?? 20), 0);
  return total / teamPlayers.length;
}

/**
 * Fetches one match's event log, runs it through the pipeline, and inserts the result.
 * Mirrors matchData.js's buildMatchRecord + the caller's cache-set, but targets Postgres
 * instead of session/localStorage, and skips (rather than caches) 204/insufficient-data
 * matches so the sweepers can decide what to do with them.
 */
export async function processMatch(gex: GexClient, summary: MatchSummary): Promise<ProcessResult> {
  // Safety net against the two sweepers racing on the same match id — cheap read before
  // the (much more expensive, rate-limited) event fetch.
  const existing = await prisma.match.findUnique({ where: { id: summary.id }, select: { id: true } });
  if (existing) return "alreadyExists";

  const eventResult = await gex.getGameEvent(summary.id);
  if (eventResult.status === "notProcessed") return "notProcessedYet";

  const matchJson = "teamDeaths" in summary ? summary
   : await gex.getMatchById(summary.id);

  if (!matchJson) {
    throw new Error(`gex has no match record for id ${summary.id}`);
  }

  const eventJson = eventResult.data;
  const teamStats = eventJson.teamStats ?? [];
  const { players, allyTeams } = summary;

  if (teamStats.length === 0 || allyTeams.length < 2) return "insufficientData";

  const durationMin = Math.round(summary.durationMs / 60000);
  const dataset = buildMatchDataset(eventJson, players, allyTeams, durationMin);
  
  if (dataset.series.length < 3) return "insufficientData";

  //nothing in GetSortedAllyIds guarantees at least 2 elements and must be assigned
  const allyIds = getSortedAllyIds(allyTeams);

if (allyIds.length < 2) return "insufficientData";
const [allyA, allyB] = allyIds as [number, number];
  const winnerSide = getWinnerSide(allyTeams, allyIds);

  const analyzable: AnalyzableMatch = {
    series: dataset.series,
    winner: winnerSide,
    teamA: {
      name: "Ally Team A",
      skill: averageSkill(players, allyA),
      players: [],
      facts: dataset.teamFacts.A,
    },
    teamB: {
      name: "Ally Team B",
      skill: averageSkill(players, allyB),
      players: [],
      facts: dataset.teamFacts.B,
    },
    durationMin,
    wind: dataset.wind,
    playerCount: summary.playerCount ?? players.length,
    gamemode: String(summary.gamemode ?? ""),
    teamDeaths: matchJson.teamDeaths ?? [],
    spectatorCount: matchJson.spectators?.length ?? 0,
    mapDraws: matchJson.mapDraws ?? [],
    legionMatch: dataset.legionMatch,
  };

  const analysis = analyzeMatch(analyzable);

  // NOTE: dataset.unitDefsById (a Map) is deliberately NOT persisted here — nothing
  // downstream of buildSeries.js reads the raw def objects (analyzeMatch works off the
  // definitionName-keyed unitsCreatedByDef already inside teamFacts), and schema.prisma
  // has no column for it. If the frontend later needs per-unit def lookups, that's static
  // per game-version data better served by its own small reference table than duplicated
  // into every match row — flagging this rather than deciding it silently.

  try {
  await prisma.match.create({
    data: {
      id: summary.id,
      map: String(summary.map ?? "unknown map"),
      winner: String(winnerSide ?? "unknown"),
      gamemode: summary.gamemode ?? 0,
      playerCount: analyzable.playerCount,
      averageOS: summary.averageOS ?? 0,
      score: analysis.score,
      startTime: new Date(summary.startTime),
      durationMinutes: durationMin,
      // `analysis.flags` keys are exactly the 20 milestone keys, matching schema.prisma's
      // boolean columns 1:1 — Prisma throws a clear validation error immediately if this
      // ever drifts (e.g. a milestone renamed in awards.js but not in the schema).
      ...analysis.flags,
      series: dataset.series as unknown as Prisma.InputJsonValue,
      teamAFacts: dataset.teamFacts.A as unknown as Prisma.InputJsonValue,
      teamBFacts: dataset.teamFacts.B as unknown as Prisma.InputJsonValue,
      analysis: analysis as unknown as Prisma.InputJsonValue,
    },
  });
} catch (err) {
    // The findUnique check above narrows the race window but can't close it: backfill
    // and recent sweepers run as two independent async loops, both kicked off from the
    // same onReady hook, and on a fresh DB backfill's first sweep (no cursor yet) covers
    // almost the same window as the recent sweeper's. Both can reach this point for the
    // same match id before either has committed. P2002 here means someone else won that
    // race — the row exists, which is exactly the outcome we wanted, so it's a success,
    // not a failure. Any other error is a real problem and should still propagate.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return "alreadyExists";
    }
    throw err;
}
  console.log("Match: ", summary.id, " written to DB.")

  return "inserted";
}