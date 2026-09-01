import { Prisma } from "../generated/prisma/client";
import { prisma } from "../db/client";
import { buildMatchDataset } from "./buildSeries";
import { analyzeMatch } from "./analyzeMatch";
import { computeMedals } from "./raw/computeMedals";
import { computeAwards } from "./raw/computeAwards";
import { assignPlayerColors } from "./playerColors";
import { GexClient } from "../gex/client";
import type { AllyTeam, GameOutput, GameSettings, MatchSummary, Player } from "../types/gex";
import type { AnalyzableMatch, Medals } from "../types/domain";

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

function buildTeamToAllyMap(players: Player[]): Record<number, number> {
  const map: Record<number, number> = {};
  for (const p of players) map[p.teamID] = p.allyTeamID;
  return map;
}

function isPvE(players: Player[]): boolean {
  if (players.length === 0) return false;
  const firstAlly = players[0]?.allyTeamID;
  return players.every((p) => p.allyTeamID === firstAlly);
}

/**
 * Derives the three mod-detection flags from gameSettings. Centralized here (rather
 * than inline at each call site, which is where the original bug lived) for two
 * reasons: both processMatch and processWebhookPayload need identical logic, and
 * gameSettings itself can be entirely absent — accessing a property directly off an
 * undefined gameSettings (as the original inline version did) throws a TypeError
 * before the trailing `?? false` ever gets a chance to matter, since a boolean
 * comparison chain never itself produces null/undefined for `?? false` to catch.
 */
function deriveModFlags(gameSettings: GameSettings | undefined): {
  ecoBoost: boolean;
  extraUnits: boolean;
  modded: boolean;
} {
  if (!gameSettings) return { ecoBoost: false, extraUnits: false, modded: false };

  const ecoBoost =
    Number(gameSettings.multiplier_metalextraction ?? 1) > 1 ||
    Number(gameSettings.multiplier_energyproduction ?? 1) > 1 ||
    Number(gameSettings.startmetal ?? 0) > 1000;

  const extraUnits =
    Number(gameSettings.scavunitsforplayers ?? 0) === 1 ||
    Number(gameSettings.experimentalextraunits ?? 0) === 1;

  const modded = Boolean(gameSettings.tweakdefs) || Boolean(gameSettings.tweakunits);

  return { ecoBoost, extraUnits, modded };
}

/**
 * Everything assembleAndInsert needs, regardless of WHERE it came from — a fetch-based
 * path (searchMatches + getGameEvent + getMatchById, three calls) or a webhook payload
 * (one call's worth of data, already merged). This interface is the seam between "how
 * did we get this data" and "what do we do with it", so that seam only has to be
 * crossed once instead of duplicated per data source.
 */
interface AssembleAndInsertInput {
  id: string;
  map?: string | undefined;
  mapName?: string | undefined;
  gamemode?: number | undefined;
  playerCount?: number | undefined;
  averageOS?: number | undefined;
  durationMs: number;
  startTime: string;
  players: Player[];
  allyTeams: AllyTeam[];
  eventJson: GameOutput;
  teamDeaths: unknown[];
  spectatorCount: number;
  mapDraws: unknown[];
  gameSettings?: GameSettings | undefined;
  teams?: { teamID: number; startingPosition?: { x: number; z: number } }[] | undefined;
}

async function assembleAndInsert(input: AssembleAndInsertInput): Promise<ProcessResult> {
  const teamStats = input.eventJson.teamStats ?? [];
  if (teamStats.length === 0 || input.allyTeams.length < 2) return "insufficientData";

  // Merge starting positions from teams array into players array.
  // The gex API puts startingPosition on the teams[] objects, not players[].
  // This merge enables per-player start position tracking for map visualization.
  const teamsByTeamID = new Map((input.teams ?? []).map((t) => [t.teamID, t]));
  const playersWithPositions = input.players.map((p) => {
    const team = teamsByTeamID.get(p.teamID);
    return team?.startingPosition
      ? { ...p, startingPosition: team.startingPosition }
      : p;
  }) as (Player & { startingPosition?: { x: number; z: number } })[];

  const durationMin = Math.round(input.durationMs / 60000);
  const dataset = buildMatchDataset(input.eventJson, playersWithPositions, input.allyTeams, durationMin);
  if (dataset.series.length < 3) return "insufficientData";

  const allyIds = getSortedAllyIds(input.allyTeams);
  if (allyIds.length < 2) return "insufficientData";
  const [allyA, allyB] = allyIds as [number, number];
  const winnerSide = getWinnerSide(input.allyTeams, allyIds);
  const { ecoBoost, extraUnits, modded } = deriveModFlags(input.gameSettings);
  const teamToAlly = buildTeamToAllyMap(playersWithPositions);
  const pveFlag = isPvE(playersWithPositions);
  const playerColors = assignPlayerColors(playersWithPositions, allyA, allyB);

  const medals: Medals = {
    ...computeMedals({
      unitsCreated: (input.eventJson.unitsCreated as unknown[]) ?? [],
      unitsKilled: (input.eventJson.unitsKilled as unknown[]) ?? [],
      unitDamage: (input.eventJson.unitDamage as unknown[]) ?? [],
      unitDefinitions: (input.eventJson.unitDefinitions as unknown[]) ?? [],
      players: playersWithPositions,
      teamToAlly,
    }),
    awards: computeAwards({
      unitsCreated: (input.eventJson.unitsCreated as unknown[]) ?? [],
      unitsKilled: (input.eventJson.unitsKilled as unknown[]) ?? [],
      teamStats: (input.eventJson.teamStats as unknown[]) ?? [],
      unitDefinitions: (input.eventJson.unitDefinitions as unknown[]) ?? [],
      players: playersWithPositions,
      teamToAlly,
      playerColors,
    }) as Medals["awards"],
  };

  const analyzable: AnalyzableMatch = {
    series: dataset.series,
    winner: winnerSide,
    teamA: {
      name: "Ally Team A",
      skill: averageSkill(playersWithPositions, allyA),
      players: [],
      facts: dataset.teamFacts.A,
    },
    teamB: {
      name: "Ally Team B",
      skill: averageSkill(playersWithPositions, allyB),
      players: [],
      facts: dataset.teamFacts.B,
    },
    durationMin,
    wind: dataset.wind,
    playerCount: input.playerCount ?? playersWithPositions.length,
    gamemode: String(input.gamemode ?? ""),
    teamDeaths: input.teamDeaths,
    spectatorCount: input.spectatorCount,
    mapDraws: input.mapDraws,
    ecoBoost,
    extraUnits,
    modded,
    legionMatch: dataset.legionMatch,
    players: playersWithPositions,
  };

  const analysis = analyzeMatch(analyzable);

  // NOTE: dataset.unitDefsById (a Map) is deliberately NOT persisted here — nothing
  // downstream of buildSeries.js reads the raw def objects, and schema.prisma has no
  // column for it. Static per-game-version data, not per-match — see earlier discussion.

  try {
    await prisma.match.create({
      data: {
        id: input.id,
        map: String(input.map ?? "unknown map"),
        mapName: input.mapName ?? null,
        winner: String(winnerSide ?? "unknown"),
        gamemode: input.gamemode ?? 0,
        playerCount: analyzable.playerCount,
        averageOS: input.averageOS ?? 0,
        score: analysis.score,
        startTime: new Date(input.startTime),
        durationMinutes: durationMin,
        // `analysis.flags` keys are exactly the 20 milestone keys, matching
        // schema.prisma's boolean columns 1:1.
        ...analysis.flags,
        pve: pveFlag,
        medals: medals as unknown as Prisma.InputJsonValue,
        series: dataset.series as unknown as Prisma.InputJsonValue,
        teamAFacts: dataset.teamFacts.A as unknown as Prisma.InputJsonValue,
        teamBFacts: dataset.teamFacts.B as unknown as Prisma.InputJsonValue,
        analysis: analysis as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // Same idempotency reasoning as before — now with a THIRD potential source of
    // concurrent inserts: the webhook can fire for a match at almost the same moment
    // either sweeper independently discovers it. Still cheap to absorb, same as the
    // original two-sweeper race.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return "alreadyExists";
    }
    throw err;
  }

  return "inserted";
}

/**
 * Fetch-based path, used by both sweepers: fetches a match's event log (and, if the
 * summary doesn't already carry it, the extra teamDeaths/spectators/mapDraws fields)
 * from gex, then hands off to the shared assembleAndInsert core.
 */
export async function processMatch(gex: GexClient, summary: MatchSummary): Promise<ProcessResult> {
  const existing = await prisma.match.findUnique({ where: { id: summary.id }, select: { id: true } });
  if (existing) return "alreadyExists";

  const eventResult = await gex.getGameEvent(summary.id);
  if (eventResult.status === "notProcessed") return "notProcessedYet";

  // Only re-fetch via getMatchById when summary doesn't already carry these fields
  // (true when summary came from searchMatches; false when it already came from
  // getMatchById, e.g. via the on-demand /matches/:id/analyze route).
  const matchJson = "teamDeaths" in summary ? summary : await gex.getMatchById(summary.id);
  if (!matchJson) {
    throw new Error(`gex has no match record for id ${summary.id}`);
  }

  return assembleAndInsert({
    id: summary.id,
    map: summary.map,
    mapName: undefined, // fetch path only has display name
    gamemode: summary.gamemode,
    playerCount: summary.playerCount,
    averageOS: summary.averageOS,
    durationMs: summary.durationMs,
    startTime: summary.startTime,
    players: summary.players,
    allyTeams: summary.allyTeams,
    eventJson: eventResult.data,
    teamDeaths: matchJson.teamDeaths ?? [],
    spectatorCount: matchJson.spectators?.length ?? 0,
    mapDraws: matchJson.mapDraws ?? [],
    gameSettings: matchJson.gameSettings,
    teams: (matchJson as unknown as Record<string, unknown>).teams as { teamID: number; startingPosition?: { x: number; z: number } }[] | undefined,
  });
}

/**
 * Webhook path: the payload already contains everything (per the maintainer) — no gex
 * fetch, no rate limiter involvement at all. See types/gexWebhook.ts for the caveat
 * that this payload shape is a best guess pending a real example from the maintainer;
 * this function's field mapping will need adjusting once that's confirmed.
 */
export async function processWebhookPayload(payload: {
  id: string;
  map?: string | undefined;
  mapName?: string | undefined;
  gamemode?: number | undefined;
  playerCount?: number | undefined;
  averageOS?: number | undefined;
  durationMs: number;
  startTime: string;
  players: Player[];
  allyTeams: AllyTeam[];
  teamStats?: unknown[] | null;
  teamDeaths?: unknown[] | undefined;
  spectators?: unknown[] | undefined;
  mapDraws?: unknown[] | undefined;
  gameSettings?: GameSettings | undefined;
  teams?: { teamID: number; startingPosition?: { x: number; z: number } }[] | undefined;
  [key: string]: unknown;
}): Promise<ProcessResult> {
  const existing = await prisma.match.findUnique({ where: { id: payload.id }, select: { id: true } });
  if (existing) return "alreadyExists";

  return assembleAndInsert({
    id: payload.id,
    map: payload.map,
    mapName: payload.mapName,
    gamemode: payload.gamemode,
    playerCount: payload.playerCount,
    averageOS: payload.averageOS,
    durationMs: payload.durationMs,
    startTime: payload.startTime,
    players: payload.players,
    allyTeams: payload.allyTeams,
    // The payload IS the GameOutput too, per the maintainer — cast rather than
    // re-fetch. Field names beyond teamStats (unitsCreated, windUpdates, etc.) are
    // assumed to match GameOutput's shape; confirm against a real payload.
    eventJson: payload as unknown as GameOutput,
    teamDeaths: payload.teamDeaths ?? [],
    spectatorCount: payload.spectators?.length ?? 0,
    mapDraws: payload.mapDraws ?? [],
    gameSettings: payload.gameSettings,
    teams: payload.teams,
  });
}