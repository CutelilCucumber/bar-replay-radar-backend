import type { AllyTeam, GameSettings, Player, Team } from "./gex";

export interface GexWebhookMatch {
  id: string;
  map?: string;
  mapName?: string;
  gamemode?: number;
  playerCount?: number;
  averageOS?: number;
  durationMs: number;
  startTime: string;
  players: Player[];
  allyTeams: AllyTeam[];
  teams?: Team[];
  teamDeaths?: unknown[];
  spectators?: unknown[];
  mapDraws?: unknown[];
  gameSettings?: GameSettings;
}

// Confirmed against a real payload — field is `unitDefinitions`, not `unitDefs`
// (types/gex.ts's GameOutput interface still says `unitDefs`; that was an earlier
// guess and is worth correcting there too, since buildSeries.js's raw JS destructures
// `unitDefinitions` directly and has been right about the runtime shape all along).
export interface GexWebhookOutput {
  gameID: string;
  unitDefinitions?: unknown[];
  windUpdates?: unknown[];
  unitsCreated?: unknown[];
  unitsKilled?: unknown[];
  unitsTaken?: unknown[];
  unitsGiven?: unknown[];
  factoryUnitCreated?: unknown[];
  commanderPositionUpdates?: unknown[];
  extraStats?: unknown[];
  transportLoaded?: unknown[];
  transportUnloaded?: unknown[];
  teamDiedEvents?: unknown[];
  unitResources?: unknown[];
  unitDamage?: unknown[];
  unitPosition?: unknown[];
  teamStats?: unknown[] | null;
}

export interface GexWebhookPayload {
  match: GexWebhookMatch;
  output: GexWebhookOutput;
}