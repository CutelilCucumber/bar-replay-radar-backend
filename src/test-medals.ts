/**
 * Standalone test script: runs matchExample.json through the pipeline
 * and prints medals, awards, PvE flag, and start positions.
 *
 * Usage: npx tsx src/test-medals.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildMatchDataset } from "./pipeline/buildSeries.js";
import { analyzeMatch } from "./pipeline/analyzeMatch.js";
import { computeMedals } from "./pipeline/raw/computeMedals.js";
import { computeAwards } from "./pipeline/raw/computeAwards.js";
import { assignPlayerColors } from "./pipeline/playerColors.js";

const FRAMES_PER_SECOND = 30;

// --- Load and flatten matchExample.json ---

const raw = readFileSync(resolve(import.meta.dirname, "../matchExample.json"), "utf-8");
const example = JSON.parse(raw);

const match = example.match;
const events = example.events;
const unitDefs = Array.isArray(example.unitDefinitions) ? example.unitDefinitions : [];

// Inject unitDefinitions into events so buildMatchDataset can find them
events.unitDefinitions = unitDefs;

// Build teamToAlly map
const teamToAlly: Record<number, number> = {};
for (const p of match.players) teamToAlly[p.teamID] = p.allyTeamID;

// Merge starting positions from teams into players
const teamsByTeamID = new Map((match.teams ?? []).map((t: any) => [t.teamID, t]));
const playersWithPositions = match.players.map((p: any) => {
  const team = teamsByTeamID.get(p.teamID);
  return team?.startingPosition
    ? { ...p, startingPosition: team.startingPosition }
    : p;
});

const durationMin = Math.round(match.durationMs / 60000);

// --- Run pipeline ---

console.log("=== Match Info ===");
console.log(`ID: ${match.id}`);
console.log(`Map: ${match.map}`);
console.log(`Duration: ${durationMin} min (${match.durationMs}ms)`);
console.log(`Players: ${match.playerCount}`);
console.log(`Gamemode: ${match.gamemode}`);
console.log(`Average OS: ${match.averageOS}`);
console.log();

// Build dataset
const dataset = buildMatchDataset(events, playersWithPositions, match.allyTeams, durationMin);

console.log("=== Series ===");
console.log(`Buckets: ${dataset.series.length} minutes`);
console.log(`First: t=${dataset.series[0]?.t}, armyA=${dataset.series[0]?.armyA}, armyB=${dataset.series[0]?.armyB}`);
console.log(`Last:  t=${dataset.series.at(-1)?.t}, armyA=${dataset.series.at(-1)?.armyA}, armyB=${dataset.series.at(-1)?.armyB}`);
console.log();

console.log("=== Start Positions ===");
console.log("Team A:", JSON.stringify(dataset.teamFacts.A.startPositions, null, 2));
console.log("Team B:", JSON.stringify(dataset.teamFacts.B.startPositions, null, 2));
console.log();

// PvE check
const pveFlag = playersWithPositions.length > 0 && playersWithPositions.every((p: any) => p.allyTeamID === playersWithPositions[0].allyTeamID);
console.log("=== PvE ===");
console.log(`PvE: ${pveFlag}`);
console.log();

// Medals
const medals = computeMedals({
  unitsCreated: events.unitsCreated ?? [],
  unitsKilled: events.unitsKilled ?? [],
  unitDamage: events.unitDamage ?? [],
  unitDefinitions: unitDefs,
  players: playersWithPositions,
  teamToAlly,
});

console.log("=== Medals: Veteran Units (top 3 by experience) ===");
for (const m of medals.veteranUnits) {
  const status = m.destroyedFrame ? `Destroyed at frame ${m.destroyedFrame}` : "Survived";
  console.log(`  ${m.definitionName} (${m.playerName}, Team ${m.allyTeam}) — ${m.kills} kills, exp=${m.experience.toFixed(4)}, rank=${m.rank}, ${status}`);
  if (m.highestValueKill) {
    console.log(`    Best kill: ${m.highestValueKill.definitionName} (cost ${m.highestValueKill.cost})`);
  }
}
console.log();

console.log("=== Medals: Kill Efficiency (top 3 by kills) ===");
for (const m of medals.killEfficiency) {
  const status = m.destroyedFrame ? `Destroyed at frame ${m.destroyedFrame}` : "Survived";
  console.log(`  ${m.definitionName} (${m.playerName}, Team ${m.allyTeam}) — ${m.kills} kills, exp=${m.experience.toFixed(4)}, rank=${m.rank}, ${status}`);
  if (m.highestValueKill) {
    console.log(`    Best kill: ${m.highestValueKill.definitionName} (cost ${m.highestValueKill.cost})`);
  }
}
console.log();

console.log("=== Medals: Damage Taken (top 3 by damage absorbed) ===");
for (const m of medals.damageTaken) {
  const status = m.destroyedFrame ? `Destroyed at frame ${m.destroyedFrame}` : "Survived";
  console.log(`  ${m.definitionName} (${m.playerName}, Team ${m.allyTeam}) — ${(m.totalDamageTaken ?? 0).toFixed(0)} dmg taken, ${m.kills} kills, exp=${m.experience.toFixed(4)}, rank=${m.rank}, ${status}`);
}
console.log();

// Awards
const allyIds = [...new Set(match.allyTeams.map((a: any) => a.allyTeamID))].sort((a: number, b: number) => a - b);
const playerColors = assignPlayerColors(playersWithPositions, allyIds[0], allyIds[1]);
const awards = computeAwards({
  unitsCreated: events.unitsCreated ?? [],
  unitsKilled: events.unitsKilled ?? [],
  teamStats: events.teamStats ?? [],
  unitDefinitions: unitDefs,
  players: playersWithPositions,
  teamToAlly,
  playerColors,
});

const fmtAward = (a: any) => a.winner ? `${a.winner.playerName} (${a.winner.value}) [runners: ${a.runnersUp.map((r: any) => `${r.playerName}(${r.value})`).join(", ") || "—"}]` : "—";
console.log("=== Awards ===");
console.log(`  Resource Destroyer: ${fmtAward(awards.resourceDestroyer)}`);
console.log(`  Combat Master:      ${fmtAward(awards.combatMaster)}`);
console.log(`  Damage Efficiency:  ${fmtAward(awards.damageEfficiency)}`);
console.log(`  Traitor:            ${fmtAward(awards.traitor)}`);
console.log(`  Golden Cow:         ${awards.goldenCow?.playerName ?? "—"}`);
console.log(`  Most Resources:     ${awards.subAwards.mostResources ? `${awards.subAwards.mostResources.playerName} (${awards.subAwards.mostResources.value})` : "—"}`);
console.log(`  Most Damage Taken:  ${awards.subAwards.mostDamageTaken ? `${awards.subAwards.mostDamageTaken.playerName} (${awards.subAwards.mostDamageTaken.value})` : "—"}`);
console.log();

// Milestones + score
const winningAlly = match.allyTeams.find((a: any) => a.won);
const winnerSide = winningAlly?.allyTeamID === allyIds[0] ? "A" : "B";

const analysis = analyzeMatch({
  series: dataset.series,
  winner: winnerSide as "A" | "B",
  teamA: { name: "Ally Team A", skill: 5.23, players: [], facts: dataset.teamFacts.A },
  teamB: { name: "Ally Team B", skill: 9.06, players: [], facts: dataset.teamFacts.B },
  durationMin,
  wind: dataset.wind,
  teamDeaths: match.teamDeaths ?? [],
  playerCount: match.playerCount,
  gamemode: String(match.gamemode),
  spectatorCount: (match.spectators ?? []).length,
  mapDraws: match.mapDraws ?? [],
  ecoBoost: false,
  extraUnits: false,
  modded: false,
  legionMatch: dataset.legionMatch,
  players: playersWithPositions,
});

console.log("=== Milestones ===");
console.log(`Score: ${analysis.score}`);
console.log(`Winner: ${winnerSide}`);
const activeFlags = Object.entries(analysis.flags).filter(([, v]) => v).map(([k]) => k);
console.log(`Active: ${activeFlags.length > 0 ? activeFlags.join(", ") : "(none)"}`);
console.log();

console.log("=== Details ===");
console.log(JSON.stringify(analysis.details, null, 2));
