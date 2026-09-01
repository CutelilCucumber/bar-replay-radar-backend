/**
 * Per-player color assignment, mirroring BAR's end-game screen:
 * each ally team picks from a color family, ordered by skill descending —
 * the team's best player gets color1, second-best color2, etc.
 *
 * The canonical palette lives in frontend/src/playerColors.json. This module
 * intentionally duplicates the values inline because colors must be baked into
 * the stored match record at processing time (the frontend can't resolve the
 * palette without a server-side dependency, and importing ../frontend would
 * break `tsc` builds that only include src/**).
 *
 * If a team has more players than palette entries, the excess (lowest-skilled)
 * players fall back to their team's flat color (frontend COLORS.close/combat).
 */

const PALETTE = {
  team1: [
    "rgb(11, 62, 243)",
    "rgb(12, 233, 8)",
    "rgb(0, 245, 229)",
    "rgb(105, 65, 242)",
    "rgb(143, 255, 148)",
    "rgb(27, 112, 47)",
    "rgb(124, 194, 255)",
    "rgb(162, 148, 255)",
  ],
  team2: [
    "rgb(255, 16, 5)",
    "rgb(255, 210, 0)",
    "rgb(255, 97, 7)",
    "rgb(248, 8, 137)",
    "rgb(138, 40, 40)",
    "rgb(252, 238, 164)",
    "rgb(241, 144, 179)",
    "rgb(200, 139, 47)",
  ],
};

// Frontend COLORS.close / COLORS.combat — kept in sync with utils/globalVars.js.
const FALLBACK_TEAM_A = "#6fa8dc";
const FALLBACK_TEAM_B = "#e2543d";

/**
 * @param {Array} players - player objects with teamID, allyTeamID, skill
 * @param {number|undefined} allyAId - lower allyTeamID (frontend "Team A")
 * @param {number|undefined} allyBId - frontend "Team B" (undefined in PvE)
 * @returns {Record<number, string|null>} teamID -> css color
 */
export function assignPlayerColors(players, allyAId, allyBId) {
  const ids = [...new Set(players.map((p) => p.allyTeamID))];
  if (ids.length === 0) return {};

  const sideA = allyAId ?? ids[0];
  const sideB = allyBId ?? ids[1];

  // Group players per side, best skill first.
  const bySide = new Map(ids.map((id) => [id, []]));
  for (const p of players) bySide.get(p.allyTeamID)?.push(p);
  for (const sidePlayers of bySide.values()) {
    sidePlayers.sort((a, b) => Number(b.skill ?? 0) - Number(a.skill ?? 0));
  }

  /** @type {Record<number, string|null>} */
  const result = {};
  for (const [side, sidePlayers] of bySide) {
    const palette = side === sideB ? PALETTE.team2 : PALETTE.team1;
    const fallback = side === sideB ? FALLBACK_TEAM_B : FALLBACK_TEAM_A;
    for (let i = 0; i < sidePlayers.length; i++) {
      const p = sidePlayers[i];
      result[p.teamID] = i < palette.length ? palette[i] : fallback;
    }
  }
  return result;
}
