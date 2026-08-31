/**
 * Computes per-player awards from raw event data.
 *
 * Awards tracked:
 * - Resource Destroyer: player who destroyed the most resource production structures
 * - Unit Killer: player who destroyed the most mobile combat units
 * - Defense Destroyer: player who destroyed the most defensive structures
 * - Damage Efficiency: player with the best damageDealt/metalUsed ratio
 * - Traitor: player who destroyed the most allied units (friendly fire)
 * - Golden Cow: player who sweeps all awards (traitor optional)
 *
 * Per-player attribution works because BAR assigns each player a unique teamID.
 * Event data uses teamID, which maps to a specific player in the players array.
 */

// Unit classification for award categorization.
// These are definitionName prefixes/matches for common BAR units across all factions.
// Expand as needed when new units appear.

const RESOURCE_STRUCTURE_DEFS = new Set([
  // Extractors (T1)
  "cormex", "legmex", "armmex",
  // Extractors (T2 - Moho mines)
  "cormoho", "legmoho", "armmoho",
  // Wind generators
  "corwin", "legwin", "armwin",
  // Solar collectors
  "corsolar", "legsolar", "armsolar",
  // Advanced fusion reactors
  "corafus", "legafus", "armafus",
  // Energy converters / makers
  "cormakr", "legmakr", "armmakr",
  // Advanced energy converters
  "coradveconv", "legadveconv", "armadveconv",
  // Tidal generators
  "cortide", "legtide", "armtide",
  // Fusion reactors
  "corfus", "legfus", "armfus",
]);

const DEFENSE_STRUCTURE_DEFS = new Set([
  // Light laser towers
  "corllt", "leglht", "armllt",
  // Heavy laser towers
  "corhlt", "leghlt", "armhlt",
  // Rocket launchers
  "corrl", "legrl", "armrl",
  // Flak
  "corflak", "legflak", "armflak",
  // Heavy defense
  "corvipe", "legvipe", "armvipe",
  "cordoom", "legdoom", "armdoom",
  // Pop-up turrets
  "corptl", "legptl", "armptl",
  "corpun", "legpun", "armpun",
  // Anti-nuke
  "corantinuke", "legantinuke", "armantinuke",
  // Shields
  "corshield", "legshield", "armshield",
]);

/**
 * @param {object} params
 * @param {Array} params.unitsCreated - unit_created events
 * @param {Array} params.unitsKilled - unit_killed events
 * @param {Array} params.teamStats - team_stats events (cumulative per frame)
 * @param {Array} params.unitDefinitions - unit definition objects
 * @param {Array} params.players - player objects with teamID, name, etc.
 * @param {Record<number, number>} params.teamToAlly - teamID -> allyTeamID map
 * @returns {object} awards object
 */
export function computeAwards({
  unitsCreated = [],
  unitsKilled = [],
  teamStats = [],
  unitDefinitions = [],
  players = [],
  teamToAlly = {},
}) {
  const defsById = new Map();
  for (const def of unitDefinitions) defsById.set(def.definitionID, def);

  const playerByTeam = new Map();
  for (const p of players) playerByTeam.set(p.teamID, p);

  // Helper to resolve a player from a teamID
  const resolvePlayer = (teamID) => {
    const p = playerByTeam.get(teamID);
    return {
      teamID,
      playerName: p?.name ?? p?.username ?? (teamID != null ? `Team ${teamID}` : null),
      allyTeam: teamID != null ? (teamToAlly[teamID] === 0 ? "A" : "B") : null,
    };
  };

  // --- Resource Destroyer ---
  // Count how many resource structures each player destroyed
  const resourceKillsByTeam = new Map();
  for (const k of unitsKilled) {
    if (k.attackerTeam == null) continue;
    const def = defsById.get(k.definitionID);
    const name = def?.definitionName ?? "";
    if (RESOURCE_STRUCTURE_DEFS.has(name)) {
      resourceKillsByTeam.set(
        k.attackerTeam,
        (resourceKillsByTeam.get(k.attackerTeam) ?? 0) + 1,
      );
    }
  }

  // --- Unit Killer ---
  // Count how many mobile combat units each player destroyed
  // Mobile combat = created units that are NOT structures (heuristic: structures don't move)
  // We classify by checking if the killed unit was in unitsCreated (mobile) and not a known structure
  const createdUnitDefs = new Set(unitsCreated.map((u) => u.definitionID));
  const unitKillsByTeam = new Map();
  for (const k of unitsKilled) {
    if (k.attackerTeam == null) continue;
    const def = defsById.get(k.definitionID);
    const name = def?.definitionName ?? "";
    // Skip known structures
    if (RESOURCE_STRUCTURE_DEFS.has(name) || DEFENSE_STRUCTURE_DEFS.has(name)) continue;
    // Only count if it was a created unit (not a map feature)
    if (!createdUnitDefs.has(k.definitionID)) continue;
    unitKillsByTeam.set(
      k.attackerTeam,
      (unitKillsByTeam.get(k.attackerTeam) ?? 0) + 1,
    );
  }

  // --- Defense Destroyer ---
  // Count how many defense structures each player destroyed
  const defenseKillsByTeam = new Map();
  for (const k of unitsKilled) {
    if (k.attackerTeam == null) continue;
    const def = defsById.get(k.definitionID);
    const name = def?.definitionName ?? "";
    if (DEFENSE_STRUCTURE_DEFS.has(name)) {
      defenseKillsByTeam.set(
        k.attackerTeam,
        (defenseKillsByTeam.get(k.attackerTeam) ?? 0) + 1,
      );
    }
  }

  // --- Damage Efficiency ---
  // damageDealt / metalUsed from teamStats (final cumulative values per team)
  const finalStats = new Map();
  for (const s of teamStats) {
    const existing = finalStats.get(s.teamID);
    if (!existing || s.frame > existing.frame) finalStats.set(s.teamID, s);
  }
  const efficiencyByTeam = new Map();
  for (const [teamID, stats] of finalStats) {
    const dealt = Number(stats.damageDealt ?? 0);
    const used = Number(stats.metalUsed ?? 0);
    if (used > 0) efficiencyByTeam.set(teamID, dealt / used);
  }

  // --- Traitor ---
  // Friendly fire: attackerTeam != victim teamID but same allyTeamID
  const traitorKillsByTeam = new Map();
  for (const k of unitsKilled) {
    if (k.attackerTeam == null || k.attackerTeam === k.teamID) continue;
    const attackerAlly = teamToAlly[k.attackerTeam];
    const victimAlly = teamToAlly[k.teamID];
    if (attackerAlly != null && attackerAlly === victimAlly) {
      traitorKillsByTeam.set(
        k.attackerTeam,
        (traitorKillsByTeam.get(k.attackerTeam) ?? 0) + 1,
      );
    }
  }

  // --- Pick winners ---
  const pickWinner = (countsByTeam) => {
    let best = null;
    let bestVal = 0;
    for (const [teamID, count] of countsByTeam) {
      if (count > bestVal) {
        bestVal = count;
        best = teamID;
      }
    }
    if (best == null) return { teamID: null, playerName: null, value: 0, allyTeam: null };
    const p = resolvePlayer(best);
    return { ...p, value: bestVal };
  };

  const pickEfficiencyWinner = () => {
    let best = null;
    let bestVal = 0;
    for (const [teamID, ratio] of efficiencyByTeam) {
      if (ratio > bestVal) {
        bestVal = ratio;
        best = teamID;
      }
    }
    if (best == null) return { teamID: null, playerName: null, value: 0, allyTeam: null };
    const p = resolvePlayer(best);
    return { ...p, value: Math.round(bestVal * 100) / 100 };
  };

  const resourceDestroyer = pickWinner(resourceKillsByTeam);
  const unitKiller = pickWinner(unitKillsByTeam);
  const defenseDestroyer = pickWinner(defenseKillsByTeam);
  const damageEfficiency = pickEfficiencyWinner();
  const traitor = pickWinner(traitorKillsByTeam);

  // --- Golden Cow ---
  // Player who wins resourceDestroyer, unitKiller, defenseDestroyer, AND damageEfficiency
  // (traitor is optional)
  let goldenCow = null;
  const candidates = [resourceDestroyer, unitKiller, defenseDestroyer, damageEfficiency];
  const nonNull = candidates.filter((c) => c.teamID != null);
  if (nonNull.length === 4) {
    const firstTeam = nonNull[0].teamID;
    if (nonNull.every((c) => c.teamID === firstTeam)) {
      goldenCow = { teamID: firstTeam, playerName: nonNull[0].playerName, allyTeam: nonNull[0].allyTeam };
    }
  }

  return {
    resourceDestroyer,
    unitKiller,
    defenseDestroyer,
    damageEfficiency,
    traitor,
    goldenCow,
  };
}
