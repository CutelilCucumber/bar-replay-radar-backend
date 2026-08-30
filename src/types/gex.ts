// Shapes describing what gex gives us. These describe the EXTERNAL API only — never
// reshape these to be more convenient for our own use; that reshaping happens in the
// pipeline (buildSeries/analyzeMatch), and its outputs belong in types/domain.ts instead.

export type Gamemode = 1 | 2 | 3 | 4 | 5; // duel, small teams, large teams, ffa, team ffa

export interface AllyTeam {
  allyTeamID: number;
  won: boolean;
}

export interface Player {
  allyTeamID: number;
  skill?: number;
}

// gex's per-match game settings blob. Only the fields actually read anywhere
// (deriveModFlags in processMatch.ts) are named; it carries many more that nothing
// here cares about yet — [key: string]: unknown covers the rest without modeling the
// whole settings object up front.
export interface GameSettings {
  multiplier_metalextraction?: number;
  multiplier_energyproduction?: number;
  startmetal?: number;
  scavunitsforplayers?: number;
  experimentalextraunits?: number;
  tweakdefs?: unknown;
  tweakunits?: unknown;
  [key: string]: unknown;
}

// One row from GET /api/match/search — also the shape returned by GET /api/match/{id}
// (getMatchById), which is a strict superset including teamDeaths/spectators/mapDraws/
// gameSettings that search results don't carry.
export interface MatchSummary {
  id: string;
  map?: string;
  gamemode?: Gamemode;
  playerCount?: number;
  averageOS?: number;
  durationMs: number;
  startTime: string; // ISO date-time string, as returned by gex
  players: Player[];
  allyTeams: AllyTeam[];
  playerLeaves?: unknown[];
  spectators?: unknown[];
  mapDraws?: unknown[];
  teamDeaths?: unknown[];
  gameSettings?: GameSettings;
}

export interface MatchSearchFilters {
  limit: number;
  gamemode?: Gamemode;
  minDurationMinutes?: number;
  minPlayers?: number;
  minimumAverageOS?: number;
  /** Inclusive upper bound — used by the backfill sweeper to page strictly backward in time. */
  startTimeBefore?: string; // ISO date-time
  /** Positional offset into the desc-ordered result list — used by the recent sweeper only. */
  offset?: number;
}

// The raw GameOutput object from GET /api/game-event/{id}. Every field beyond the id
// is opt-in via an `include*` query flag, hence everything (bar id) is optional here —
// this type describes "the union of everything you *could* get back", not what any one
// call actually returns. Only fields the current pipeline reads are modeled; extend as needed.
export interface GameOutput {
  gameId: string;
  teamStats?: unknown[] | null;
  extraStats?: unknown[] | null;
  windUpdates?: unknown[];
  unitsCreated?: unknown[];
  unitsKilled?: unknown[];
  unitDamage?: unknown[];
  // Confirmed against a real webhook payload: the field is `unitDefinitions`, not
  // `unitDefs` — buildSeries.js's raw JS destructures `unitDefinitions` directly and
  // has been right about the runtime shape all along; this type just had the wrong
  // name until now.
  unitDefinitions?: unknown[];
  unitResources?: unknown[];
  factoryUnitCreate?: unknown[];
  teamDiedEvents?: unknown[];
  commanderPositionUpdates?: unknown[];
}

// The gex game-event endpoint returns 204 (empty body) when the match hasn't been
// processed yet. This discriminated union makes that a first-class, unignorable state
// instead of a null check someone has to remember to write.
export type GameEventResult =
  | { status: "ready"; data: GameOutput }
  | { status: "notProcessed" };