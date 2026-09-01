/**
 * Computes unit-level medals from raw event data.
 *
 * Tracks the top 3 units in four categories:
 * - Damage Efficiency: most damage dealt per metal cost
 * - Damage Dealt: most cumulative damage dealt
 * - Damage Taken: most damage absorbed
 * - Veteran Units: highest experience/rank
 *
 * Each medal entry includes the unit's definition name, the player who built it
 * (resolved via teamID -> players array), build/destroy frames, kill count,
 * damage dealt/taken, metal cost, veterancy stats, and highest-value kill.
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
 * @param {Record<number, string|null>} params.playerColors - teamID -> css color
 * @returns {{ damageEfficiency: Array, damageDealt: Array, damageTaken: Array, veteranUnits: Array }}
 */
export function computeMedals({
  unitsCreated = [],
  unitsKilled = [],
  unitDamage = [],
  unitDefinitions = [],
  players = [],
  teamToAlly = {},
  playerColors = {},
}) {
  const defsById = new Map();
  for (const def of unitDefinitions) defsById.set(def.definitionID, def);

  const createdById = new Map();
  for (const u of unitsCreated) createdById.set(u.unitID, u);

  const playerByTeam = new Map();
  for (const p of players) playerByTeam.set(p.teamID, p);

  // Latest unitDamage entry per unitID (highest frame = final state) and total
  // damageTaken per unitID — merged into a single pass over unitDamage (the array
  // can be large for long matches, so one traversal instead of two).
  const latestDamage = new Map();
  const totalDamageTaken = new Map();
  for (const d of unitDamage) {
    const existing = latestDamage.get(d.unitID);
    if (!existing || d.frame > existing.frame) latestDamage.set(d.unitID, d);
    totalDamageTaken.set(
      d.unitID,
      (totalDamageTaken.get(d.unitID) ?? 0) + Number(d.damageTaken ?? 0),
    );
  }

  // Kills grouped by attackerID, aggregated inline: count + the highest-value kill.
  // Storing the full kill objects in per-attacker arrays (the old approach) held a
  // reference to every kill event; counting here needs only two scalars per attacker.
  const killStatsByAttacker = new Map();
  for (const k of unitsKilled) {
    if (k.attackerID == null) continue;
    const killDef = defsById.get(k.definitionID);
    const cost = killDef?.metalCost ?? 0;
    const entry =
      killStatsByAttacker.get(k.attackerID) ??
      { count: 0, bestCost: 0, highestValueKill: null };
    entry.count += 1;
    if (cost > entry.bestCost) {
      entry.bestCost = cost;
      entry.highestValueKill = {
        definitionName: killDef?.definitionName ?? "unknown",
        cost,
      };
    }
    killStatsByAttacker.set(k.attackerID, entry);
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
    const killStats = killStatsByAttacker.get(unitID);

    entries.push({
      unitID,
      definitionName: name,
      playerName: player?.name ?? player?.username ?? `Team ${created.teamID}`,
      teamID: created.teamID,
      allyTeam: ally === 0 ? "A" : "B",
      color: created.teamID != null ? (playerColors[created.teamID] ?? null) : null,
      buildFrame: created.frame,
      destroyedFrame: destroyedFrame.get(unitID) ?? null,
      kills: killStats?.count ?? 0,
      experience: Number(dmg.experience ?? 0),
      rank: Number(dmg.rank ?? 0),
      damageDealt: Number(dmg.damageDealt ?? 0),
      metalCost: Number(def?.metalCost ?? 0),
      highestValueKill: killStats?.highestValueKill ?? null,
      totalDamageTaken: totalDamageTaken.get(unitID) ?? 0,
    });
  }

  // Sort and take top N for each category
  const damageEfficiency = [...entries]
    .sort((a, b) => {
      const efficiencyOf = (e) =>
        e.metalCost > 0 ? e.damageDealt / e.metalCost : e.damageDealt;
      return efficiencyOf(b) - efficiencyOf(a);
    })
    .slice(0, TOP_N);

  const damageDealt = [...entries]
    .sort((a, b) => b.damageDealt - a.damageDealt)
    .slice(0, TOP_N);

  const damageTaken = [...entries]
    .sort((a, b) => b.totalDamageTaken - a.totalDamageTaken)
    .slice(0, TOP_N);

  const veteranUnits = [...entries]
    .sort((a, b) => b.experience - a.experience || b.rank - a.rank)
    .slice(0, TOP_N);

  return { damageEfficiency, damageDealt, damageTaken, veteranUnits };
}
