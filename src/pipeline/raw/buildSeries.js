import { assignPlayerColors } from "../playerColors.js";

// Position data (per-player start coordinates for the frontend map) is the
// heaviest part of the per-team facts. Default ON; set ENABLE_POSITION_DATA=false
// to skip computing/storing it and cut memory pressure (e.g. tight hosts).
const ENABLE_POSITION_DATA = process.env.ENABLE_POSITION_DATA !== "false";

const FRAMES_PER_SECOND = 30;
const BUCKET_FRAMES = 60 * FRAMES_PER_SECOND; // frames per 1-minute bucket

/**
 * Builds the full per-match dataset used by the milestone analysis module:
 * a per-minute A/B time series, plus per-team "facts" that aren't naturally
 * time-bucketed (commander deaths, unit diversity, rush timings, etc).
 *
 * @param {object} eventJson - GameOutput from /api/game-event/:id
 * @param {Array} players - BarMatchPlayer[], used to map teamID -> allyTeamID
 * @param {Array} allyTeams - BarMatchAllyTeam[] for this match
 * @param {number} durationMin - total match duration in minutes
 * @returns {{
 *   series: Array,
 *   teamFacts: { A: object, B: object },
 *   wind: { average: number, samples: Array },
 *   unitDefsById: Map<number, object>,
 * }}
 */
export function bucketFrameStatsToSeries(
  eventJson,
  players,
  allyTeams,
  durationMin,
) {
  const {
    teamStats = [],
    extraStats = [],
    unitsCreated = [],
    unitsKilled = [],
    unitDamage = [],
    unitResources = [],
    windUpdates = [],
    teamDiedEvents = [],
    commanderPositionUpdates = [],
    unitDefinitions = [],
  } = eventJson ?? {};

  const teamToAlly = buildTeamToAllyMap(players);
  const [allyA, allyB] = getSortedAllyIds(allyTeams);
  const playerColors = assignPlayerColors(players, allyA, allyB);
  const unitDefsById = buildUnitDefsById(unitDefinitions);
  const matchDurationFrames = durationMin * 60 * FRAMES_PER_SECOND;

  const series = buildSeries({
    teamStats,
    extraStats,
    teamToAlly,
    allyA,
    allyB,
  });

  const teamFacts = {
    A: buildTeamFacts({
      ally: allyA,
      opponentAlly: allyB,
      teamToAlly,
      players,
      playerColors,
      unitDefsById,
      unitsCreated,
      unitsKilled,
      teamDiedEvents,
      commanderPositionUpdates,
      series,
      matchDurationFrames,
      seriesKeys: {
        army: "armyA",
        dmg: "dmgA",
        eco: "ecoA",
        metalUsed: "metalUsedA",
        actions: "actionsA",
      },
    }),
    B: buildTeamFacts({
      ally: allyB,
      opponentAlly: allyA,
      teamToAlly,
      players,
      playerColors,
      unitDefsById,
      unitsCreated,
      unitsKilled,
      teamDiedEvents,
      commanderPositionUpdates,
      series,
      matchDurationFrames,
      seriesKeys: {
        army: "armyB",
        dmg: "dmgB",
        eco: "ecoB",
        metalUsed: "metalUsedB",
        actions: "actionsB",
      },
    }),
  };

  return {
    series,
    teamFacts,
    wind: buildWindSummary(windUpdates),
    unitDefsById,
    legionMatch: detectLegionEnabled(unitsCreated),
  };

  // unitResources and unitDamage are included in the fetch (per-unit granularity)
  // but aren't consumed here yet — combat efficiency below uses the team-level
  // teamStats.damageDealt / metalUsed instead. Left in the destructure above so
  // they're easy to wire in if a milestone needs unit-level damage later.
  void unitDamage;
  void unitResources;
}

/**
 * teamID -> allyTeamID, so per-team event rows can be attributed to a side.
 */
function buildTeamToAllyMap(players) {
  const map = {};
  for (const p of players) map[p.teamID] = p.allyTeamID;
  return map;
}

/**
 * The two allyTeamIDs in this match, sorted ascending (lower = "A").
 */
function getSortedAllyIds(allyTeams) {
  return [...new Set(allyTeams.map((a) => a.allyTeamID))].sort((a, b) => a - b);
}

/**
 * definitionID -> unit definition (name, group, cost, isCommander/isFactory, ...),
 * so callers can classify any unitID they encounter without a second lookup.
 */
function buildUnitDefsById(unitDefinitions) {
  const map = new Map();
  for (const def of unitDefinitions) map.set(def.definitionID, def);
  return map;
}

/**
 * Sorts an event array by frame ascending. Bucket-building relies on this so
 * "last value in the bucket" is actually the latest, not an artifact of
 * whatever order the API returned rows in.
 */
function sortByFrame(rows) {
  return [...rows].sort((a, b) => a.frame - b.frame);
}

/**
 * Builds the per-minute A/B series. For every field, the LAST value seen
 * within a given minute is kept (not summed, not maxed) — this is correct
 * both for true point-in-time snapshots (army value, metal on hand) and for
 * monotonic counters (cumulative actions, cumulative damage dealt), since a
 * monotonic counter's last value in a window is already its max.
 */
function buildSeries({ teamStats, extraStats, teamToAlly, allyA, allyB }) {
  const buckets = new Map(); // minute -> partial row, keyed by side below

  const applyRow = (frame, ally, patch) => {
    const minute = Math.floor(frame / BUCKET_FRAMES);
    const row = buckets.get(minute) ?? { t: minute };
    const side = ally === allyA ? "A" : ally === allyB ? "B" : null;
    if (!side) return;
    for (const [key, value] of Object.entries(patch)) {
      row[`${key}${side}`] = value;
    }
    buckets.set(minute, row);
  };

  for (const row of sortByFrame(teamStats)) {
    const ally = teamToAlly[row.teamID];
    if (ally == null) continue;
    applyRow(row.frame, ally, {
      dmg: Number(row.damageDealt ?? 0),
      metalUsed: Number(row.metalUsed ?? 0),
      metalProduced: Number(row.metalProduced ?? 0),
    });
  }

  for (const row of sortByFrame(extraStats)) {
    const ally = teamToAlly[row.teamID];
    if (ally == null) continue;
    applyRow(row.frame, ally, {
      army: Number(row.armyValue ?? 0),
      eco: Number(row.ecoValue ?? 0),
      buildPower: Number(row.buildPowerUsed ?? 0),
      actions: Number(row.actions ?? 0),
    });
  }

  const minutes = [...buckets.keys()].sort((a, b) => a - b);
  return minutes.map((t) => {
    const row = buckets.get(t);
    const armyA = row.armyA ?? 0;
    const armyB = row.armyB ?? 0;
    return {
      t,
      armyA,
      armyB,
      ecoA: row.ecoA ?? 0,
      ecoB: row.ecoB ?? 0,
      dmgA: row.dmgA ?? 0,
      dmgB: row.dmgB ?? 0,
      metalUsedA: row.metalUsedA ?? 0,
      metalUsedB: row.metalUsedB ?? 0,
      buildPowerA: row.buildPowerA ?? 0,
      buildPowerB: row.buildPowerB ?? 0,
      actionsA: row.actionsA ?? 0,
      actionsB: row.actionsB ?? 0,
      // army-value-based lead, used for comeback / momentum-shift / stomp detection
      leadPct: armyA + armyB === 0 ? 0.5 : armyA / (armyA + armyB),
    };
  });
}

/**
 * Average wind speed for this match, for the "windy day" milestone and for
 * normalizing rush timings against wind-dependent AFUs. Only the average is
 * consumed downstream (analyzeMatch reads wind.average); the per-sample array
 * used to be retained here but nothing reads it, so it's not built at all.
 */
function buildWindSummary(windUpdates) {
  if (windUpdates.length === 0) return { average: 0 };
  const total = windUpdates.reduce((sum, w) => sum + Number(w.value ?? 0), 0);
  return { average: total / windUpdates.length };
}

/**
 * One-off, non-time-bucketed facts for a single side: commander tracking,
 * unit diversity, per-definition first-build frame (for rush milestones),
 * and closest commander approach to the enemy's starting position.
 */
function buildTeamFacts({
  ally,
  opponentAlly,
  teamToAlly,
  players,
  playerColors,
  unitDefsById,
  unitsCreated,
  unitsKilled,
  teamDiedEvents,
  commanderPositionUpdates,
  series,
  seriesKeys,
}) {
  const teamIDs = new Set(
    Object.entries(teamToAlly)
      .filter(([, a]) => a === ally)
      .map(([teamID]) => Number(teamID)),
  );

  const unitsCreatedForSide = unitsCreated.filter((u) => teamIDs.has(u.teamID));
  const unitsKilledForSide = unitsKilled.filter((u) => teamIDs.has(u.teamID));

  // Rush-timing / diversity lookup: definitionName -> { count, firstFrame }.
  // Callers match specific names (AFU, nukes, calamity, bombers, ...) themselves.
  const unitsCreatedByDef = {};
  const unitGroupsSeen = new Set();
  for (const u of unitsCreatedForSide) {
    const def = unitDefsById.get(u.definitionID);
    const name = def?.definitionName ?? u.definitionName ?? "unknown";
    const entry = unitsCreatedByDef[name] ?? {
      count: 0,
      firstFrame: u.frame,
      frames: [],
    };
    entry.count += 1;
    entry.firstFrame = Math.min(entry.firstFrame, u.frame);
    entry.frames.push(u.frame);
    unitsCreatedByDef[name] = entry;
    if (def?.unitGroup) unitGroupsSeen.add(def.unitGroup);
  }

  // Commander tracking: which unitIDs are commanders, and when (if ever) they died.
  const commanderUnitIDs = new Set(
    unitsCreatedForSide
      .filter((u) => unitDefsById.get(u.definitionID)?.isCommander)
      .map((u) => u.unitID),
  );
  const commanderDeaths = unitsKilledForSide
    .filter((u) => commanderUnitIDs.has(u.unitID))
    .map((u) => ({ unitID: u.unitID, frame: u.frame }));

  // Closest a commander from this side got to the opponent's average start
  // position, and on what frame — for the "commander attack" milestone.
  const opponentStart = averageStartPosition(players, opponentAlly);
  let closestApproach = null;
  if (opponentStart) {
    for (const pos of commanderPositionUpdates) {
      if (!commanderUnitIDs.has(pos.unitID)) continue;
      const dist = distance2D(
        pos.unitX,
        pos.unitZ,
        opponentStart.x,
        opponentStart.z,
      );
      if (!closestApproach || dist < closestApproach.distance) {
        closestApproach = { distance: dist, frame: pos.frame };
      }
    }
  }

  const deathEvent = teamDiedEvents.find((d) => teamIDs.has(d.teamID));
  const lastPoint = series[series.length - 2];
  const peakArmyPoint = series.reduce(
    (best, p) =>
      p[seriesKeys.army] > (best?.[seriesKeys.army] ?? -Infinity) ? p : best,
    null,
  );
  const minArmyPoint = series.reduce(
    (worst, p) =>
      p[seriesKeys.army] < (worst?.[seriesKeys.army] ?? Infinity) ? p : worst,
    null,
  );
  const peakEcoPoint = series.reduce(
    (best, p) =>
      p[seriesKeys.eco] > (best?.[seriesKeys.eco] ?? -Infinity) ? p : best,
    null,
  );

  return {
    allyTeamID: ally,
    deathFrame: deathEvent?.frame ?? null,
    finalArmyValue: lastPoint?.[seriesKeys.army] ?? 0,
    peakArmyValue: peakArmyPoint?.[seriesKeys.army] ?? 0,
    peakArmyMinute: peakArmyPoint?.t ?? null,
    minArmyValue: minArmyPoint?.[seriesKeys.army] ?? 0,
    minArmyMinute: minArmyPoint?.t ?? null,
    finalEcoValue: lastPoint?.[seriesKeys.eco] ?? 0,
    peakEcoValue: peakEcoPoint?.[seriesKeys.eco] ?? 0,
    totalDamageDealt: lastPoint?.[seriesKeys.dmg] ?? 0,
    totalMetalUsed: lastPoint?.[seriesKeys.metalUsed] ?? 0,
    totalActions: lastPoint?.[seriesKeys.actions] ?? 0,
    unitsCreatedByDef,
    unitGroupDiversity: unitGroupsSeen.size,
    commanderUnitIDs: [...commanderUnitIDs],
    commanderDeaths,
    commanderClosestApproachToEnemyBase: closestApproach,
    startPositions: ENABLE_POSITION_DATA
      ? buildStartPositions(players, ally, playerColors)
      : [],
  };
}

function averageStartPosition(players, allyTeamID) {
  const sidePlayers = players.filter(
    (p) => p.allyTeamID === allyTeamID && p.startingPosition,
  );
  if (sidePlayers.length === 0) return null;
  const sum = sidePlayers.reduce(
    (acc, p) => ({
      x: acc.x + p.startingPosition.x,
      z: acc.z + p.startingPosition.z,
    }),
    { x: 0, z: 0 },
  );
  return { x: sum.x / sidePlayers.length, z: sum.z / sidePlayers.length };
}

function distance2D(x1, z1, x2, z2) {
  return Math.hypot(x1 - x2, z1 - z2);
}

/**
 * Extracts starting positions for all players on a given ally side.
 * Returns an array of { playerName, teamID, x, z, color } for frontend map
 * visualization. color is resolved upstream via pipeline/playerColors.js.
 */
function buildStartPositions(players, allyTeamID, playerColors = {}) {
  return players
    .filter((p) => p.allyTeamID === allyTeamID && p.startingPosition)
    .map((p) => ({
      playerName: p.name ?? p.username ?? `Team ${p.teamID}`,
      teamID: p.teamID,
      x: p.startingPosition.x,
      z: p.startingPosition.z,
      color: playerColors[p.teamID] ?? null,
    }));
}

/**
 * Legion faction is detected from the commander(s) built at the very start
 * of the match: Legion commanders use the definitionName "legcom" (vs. the
 * standard Armada/Cortex commander defs). Looks at every unit created on
 * the earliest build frame, since all commanders spawn at match start.
 */
function detectLegionEnabled(unitsCreated) {
  if (unitsCreated.length === 0) return false;
  const earliestFrame = Math.min(...unitsCreated.map((u) => u.frame));
  return unitsCreated
    .filter((u) => u.frame === earliestFrame)
    .some((u) => u.definitionName === "legcom");
}
