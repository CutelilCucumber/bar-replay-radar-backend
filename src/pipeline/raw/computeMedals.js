/**
 * Computes unit-level medals from raw event data.
 *
 * Tracks the top 3 units in three categories:
 * - Veteran Units: highest experience/rank
 * - Kill Efficiency: most kills
 * - Damage Taken: most damage absorbed
 *
 * Each medal entry includes the unit's definition name, the player who built it
 * (resolved via teamID -> players array), build/destroy frames, kill count,
 * veterancy stats, and highest-value kill.
 *
 * NOTE: Per-player attribution is possible because BAR assigns each player a unique
 * teamID. Event data (unitsCreated, unitsKilled, unitDamage) uses teamID, which
 * maps directly to a specific player in the match's players array.
 *
 * TODO: Unit matchup tracking
 * The unitsKilled data has attackerDefinitionID and definitionID for both
 * attacker and victim. This enables building a unit matchup matrix:
 * "corgator kills legmos 45 times, legmos kills corgator 12 times"
 * Could power a "rock-paper-scissors" visualization or unit balance insights.
 * Requires aggregating all kills across matches by (attackerDef, victimDef) pairs.
 */

const TOP_N = 3;

/**
 * @param {object} params
 * @param {Array} params.unitsCreated
 * @param {Array} params.unitsKilled
 * @param {Array} params.unitDamage
 * @param {Array} params.unitDefinitions
 * @param {Array} params.players
 * @param {Record<number, number>} params.teamToAlly
 * @returns {{ veteranUnits: Array, killEfficiency: Array, damageTaken: Array }}
 */
export function computeMedals({
  unitsCreated = [],
  unitsKilled = [],
  unitDamage = [],
  unitDefinitions = [],
  players = [],
  teamToAlly = {},
}) {
  const defsById = new Map();
  for (const def of unitDefinitions) defsById.set(def.definitionID, def);

  const createdById = new Map();
  for (const u of unitsCreated) createdById.set(u.unitID, u);

  const playerByTeam = new Map();
  for (const p of players) playerByTeam.set(p.teamID, p);

  // Latest unitDamage entry per unitID (highest frame = final state)
  const latestDamage = new Map();
  for (const d of unitDamage) {
    const existing = latestDamage.get(d.unitID);
    if (!existing || d.frame > existing.frame) latestDamage.set(d.unitID, d);
  }

  // Total damageTaken per unitID (sum across all entries)
  const totalDamageTaken = new Map();
  for (const d of unitDamage) {
    totalDamageTaken.set(
      d.unitID,
      (totalDamageTaken.get(d.unitID) ?? 0) + Number(d.damageTaken ?? 0),
    );
  }

  // Kills grouped by attackerID
  const killsByAttacker = new Map();
  for (const k of unitsKilled) {
    if (k.attackerID == null) continue;
    const arr = killsByAttacker.get(k.attackerID) ?? [];
    arr.push(k);
    killsByAttacker.set(k.attackerID, arr);
  }

  // Destroyed frame per unitID
  const destroyedFrame = new Map();
  for (const k of unitsKilled) destroyedFrame.set(k.unitID, k.frame);

  // Build medal entries for every unit that has damage data
  const entries = [];
  for (const [unitID, dmg] of latestDamage) {
    const created = createdById.get(unitID);
    if (!created) continue;

    const def = defsById.get(created.definitionID);
    const name = def?.definitionName ?? created.definitionName ?? "unknown";
    const player = playerByTeam.get(created.teamID);
    const ally = teamToAlly[created.teamID];
    const kills = killsByAttacker.get(unitID) ?? [];

    // Find highest value kill
    let highestValueKill = null;
    let bestCost = 0;
    for (const k of kills) {
      const killDef = defsById.get(k.definitionID);
      const cost = killDef?.cost ?? 0;
      if (cost > bestCost) {
        bestCost = cost;
        highestValueKill = {
          definitionName: killDef?.definitionName ?? "unknown",
          cost,
        };
      }
    }

    entries.push({
      unitID,
      definitionName: name,
      playerName: player?.name ?? player?.username ?? `Team ${created.teamID}`,
      teamID: created.teamID,
      allyTeam: ally === 0 ? "A" : "B",
      buildFrame: created.frame,
      destroyedFrame: destroyedFrame.get(unitID) ?? null,
      kills: kills.length,
      experience: Number(dmg.experience ?? 0),
      rank: Number(dmg.rank ?? 0),
      highestValueKill,
      totalDamageTaken: totalDamageTaken.get(unitID) ?? 0,
    });
  }

  // Sort and take top N for each category
  const veteranUnits = [...entries]
    .sort((a, b) => b.experience - a.experience || b.rank - a.rank)
    .slice(0, TOP_N)
    .map(stripTotalDamageTaken);

  const killEfficiency = [...entries]
    .sort((a, b) => b.kills - a.kills || b.experience - a.experience)
    .slice(0, TOP_N)
    .map(stripTotalDamageTaken);

  const damageTaken = [...entries]
    .sort((a, b) => b.totalDamageTaken - a.totalDamageTaken)
    .slice(0, TOP_N);

  return { veteranUnits, killEfficiency, damageTaken };
}

function stripTotalDamageTaken(entry) {
  const { totalDamageTaken, ...rest } = entry;
  void totalDamageTaken;
  return rest;
}
