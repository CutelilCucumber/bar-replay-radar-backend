// This file is the ENTIRE typed boundary around it: everything downstream imports
// buildMatchDataset from here, never straight from raw/buildSeries.js.
import { bucketFrameStatsToSeries } from "./raw/buildSeries";
import type { GameOutput, Player, AllyTeam } from "../types/gex";
import type { MatchDataset } from "../types/domain";

export function buildMatchDataset(
  eventJson: GameOutput,
  players: Player[],
  allyTeams: AllyTeam[],
  durationMin: number,
): MatchDataset {
  // The cast is the one place we're trusting the JS implementation to actually match
  // MatchDataset's shape — worth a quick sanity check against real output while testing,
  // but this is the standard pattern for typing an unported module at its boundary.
  //TS won't let a direct as cast between two types that don't overlap enough, unknown fixes
  return bucketFrameStatsToSeries(eventJson, players, allyTeams, durationMin) as unknown as MatchDataset;
}