/**
 * Computes per-player awards from raw event data, in BAR's end-game shape.
 *
 * Awards tracked (each returns the winner plus up to two runners-up):
 * - Resource Destroyer: player who destroyed the most resource production structures
 * - Combat Master: player who destroyed the most units AND defense structures combined
 * - Damage Efficiency: player with the best damageDealt/metalUsed ratio
 * - Traitor: player who destroyed the most allied units (friendly fire)
 * - Golden Cow: player who sweeps resourceDestroyer + combatMaster + damageEfficiency
 *   (traitor is optional)
 *
 * Sub-awards (single winner each, derived from final cumulative team stats):
 * - Most resources produced (metalProduced + energyProduced)
 * - Most damage taken (damageReceived)
 *
 * Per-player attribution works because BAR assigns each player a unique teamID.
 * Event data uses teamID, which maps to a specific player in the players array.
 * Player colors are resolved upstream (pipeline/playerColors.js) and passed in
 * as playerColors so they get baked into the stored record alongside names.
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
 * @param {Record<number, string|null>} params.playerColors - teamID -> css color
 * @returns {object} awards object
 */
export function computeAwards({
  unitsCreated = [],
  unitsKilled = [],
  teamStats = [],
  unitDefinitions = [],
  players = [],
  teamToAlly = {},
  playerColors = {},
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
      color: teamID != null ? (playerColors[teamID] ?? null) : null,
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

  // --- Combat Master ---
  // Units AND defense structures destroyed (combined count).
  // Only resource structures are excluded; defense structures count together with
  // created mobile units (anything in unitsCreated, i.e. not a map feature).
  const createdUnitDefs = new Set(unitsCreated.map((u) => u.definitionID));
  const combatKillsByTeam = new Map();
  for (const k of unitsKilled) {
    if (k.attackerTeam == null) continue;
    const def = defsById.get(k.definitionID);
    const name = def?.definitionName ?? "";
    // Exclude resource production structures
    if (RESOURCE_STRUCTURE_DEFS.has(name)) continue;
    // Count defense structures, or otherwise only created units (not map features)
    if (!DEFENSE_STRUCTURE_DEFS.has(name) && !createdUnitDefs.has(k.definitionID)) continue;
    combatKillsByTeam.set(
      k.attackerTeam,
      (combatKillsByTeam.get(k.attackerTeam) ?? 0) + 1,
    );
  }

  // --- Damage Efficiency ---
  // damageDealt / metalUsed from final cumulative team stats
  const finalStats = finalStatsByTeam(teamStats);
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

  /**
   * Ranks a team's entries, descending by value, ignoring zero/negative values.
   * Returns { winner, runnersUp } where each entry carries player info + value.
   */
  const rankEntries = (valuesByTeam, roundValue = (v) => v) => {
    const sorted = [...valuesByTeam.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return { winner: null, runnersUp: [] };
    const entries = sorted.map(([teamID, v]) => ({
      ...resolvePlayer(teamID),
      value: roundValue(v),
    }));
    return { winner: entries[0], runnersUp: entries.slice(1, 3) };
  };

  const resourceDestroyer = rankEntries(resourceKillsByTeam);
  const combatMaster = rankEntries(combatKillsByTeam);
  const damageEfficiency = rankEntries(
    efficiencyByTeam,
    (v) => Math.round(v * 100) / 100,
  );
  const traitor = rankEntries(traitorKillsByTeam);

  // --- Golden Cow ---
  // Player who wins resourceDestroyer, combatMaster, AND damageEfficiency
  // (traitor is optional)
  let goldenCow = null;
  const winners = [resourceDestroyer, combatMaster, damageEfficiency]
    .map((a) => a.winner)
    .filter((w) => w != null);
  if (winners.length === 3) {
    const first = winners[0];
    if (winners.every((w) => w.teamID === first.teamID)) {
      const { teamID, playerName, allyTeam, color } = first;
      goldenCow = { teamID, playerName, allyTeam, color };
    }
  }

  // --- Sub-awards (final cumulative team stats, single winner each) ---
  const resourcesByTeam = new Map();
  const damageTakenByTeam = new Map();
  for (const [teamID, stats] of finalStats) {
    resourcesByTeam.set(
      teamID,
      Number(stats.metalProduced ?? 0) + Number(stats.energyProduced ?? 0),
    );
    damageTakenByTeam.set(teamID, Number(stats.damageReceived ?? 0));
  }
  const mostResources = rankEntries(resourcesByTeam).winner;
  const mostDamageTaken = rankEntries(damageTakenByTeam).winner;

  return {
    resourceDestroyer,
    combatMaster,
    damageEfficiency,
    traitor,
    goldenCow,
    subAwards: { mostResources, mostDamageTaken },
  };
}

/**
 * Latest cumulative team_stats row per team (rows are cumulative per frame,
 * so the highest frame seen per team is the final value).
 */
function finalStatsByTeam(teamStats) {
  const finalStats = new Map();
  for (const s of teamStats) {
    const existing = finalStats.get(s.teamID);
    if (!existing || s.frame > existing.frame) finalStats.set(s.teamID, s);
  }
  return finalStats;
}
