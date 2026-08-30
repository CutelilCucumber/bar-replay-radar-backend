// Types for gex webhook payloads. These mirror the gex.Models.Db.BarMatch and
// gex.Models.Event.GameOutput structs from the gex source.

export interface WebhookAllyTeam {
  allyTeamID: number;
  won: boolean;
}

export interface WebhookPlayer {
  allyTeamID: number;
  skill?: number;
  name?: string;
  isAI?: boolean;
}

export interface WebhookTeam {
  teamID: number;
  allyTeamID: number;
  players: WebhookPlayer[];
}

export interface WebhookGameSettings {
  multiplier_metalextraction: number;
  multiplier_energyproduction: number;
  startmetal: number;
  scavunitsforplayers: number;
  experimentalextraunits: number;
  tweakdefs?: boolean;
  tweakunits?: boolean;
  [key: string]: unknown;
}

export interface WebhookMapSettings {
  [key: string]: unknown;
}

export interface WebhookHostSettings {
  [key: string]: unknown;
}

export interface WebhookSpadsSettings {
  [key: string]: unknown;
}

export interface WebhookRestriction {
  [key: string]: unknown;
}

export interface WebhookChatMessage {
  [key: string]: unknown;
}

export interface WebhookTeamDeath {
  [key: string]: unknown;
}

export interface WebhookPlayerLeave {
  [key: string]: unknown;
}

export interface WebhookMapDraw {
  [key: string]: unknown;
}

export interface WebhookCommand {
  [key: string]: unknown;
}

export interface WebhookAISpectator {
  [key: string]: unknown;
}

export interface WebhookBarMap {
  [key: string]: unknown;
}

export interface WebhookStartRegionData {
  [key: string]: unknown;
}

// The BarMatch object from gex.Models.Db.BarMatch
export interface BarMatch {
  id: string;
  engine: string;
  gameVersion: string;
  startTime: string; // ISO date-time
  map: string;
  mapName: string;
  fileName: string;
  startOffset: number;
  durationMs: number;
  durationFrameCount: number;
  gamemode: number;
  hostSettings: WebhookHostSettings;
  gameSettings: WebhookGameSettings;
  mapSettings: WebhookMapSettings;
  spadsSettings: WebhookSpadsSettings;
  restrictions: WebhookRestriction[];
  teams: WebhookTeam[];
  allyTeams: WebhookAllyTeam[];
  players: WebhookPlayer[];
  spectators: WebhookPlayer[];
  aiPlayers: WebhookAISpectator[];
  chatMessages: WebhookChatMessage[];
  teamDeaths: WebhookTeamDeath[];
  playerLeaves: WebhookPlayerLeave[];
  mapDraws: WebhookMapDraw[];
  commands: WebhookCommand[];
  playerCount: number;
  uploadedByID: string;
  wrongSkillValues: boolean;
  offlineGame: boolean;
  averageOS: number;
  minOS: number;
  maxOS: number;
  startSpotVersion: number;
  mapData: WebhookBarMap;
  matchPoolEntryNote: string | null;
  matchPoolIsHidden: boolean;
  startRegionData: WebhookStartRegionData;
}

// The GameOutput object from gex.Models.Event.GameOutput
export interface GameOutput {
  gameId: string;
  unitDefinitions: unknown[];
  windUpdates: unknown[];
  unitsCreated: unknown[];
  unitsKilled: unknown[];
  unitsTaken: unknown[];
  unitsGiven: unknown[];
  factoryUnitCreated: unknown[];
  commanderPositionUpdates: unknown[];
  extraStats: unknown[];
  transportLoaded: unknown[];
  transportUnloaded: unknown[];
  teamDiedEvents: unknown[];
  unitResources: unknown[];
  unitDamage: unknown[];
  unitPosition: unknown[];
  teamStats: unknown[];
}

// Full webhook payload: { match: BarMatch, output?: GameOutput }
export interface GexWebhookPayload {
  match: BarMatch;
  output?: GameOutput;
}

// Webhook event types (gex may send different event types in the future)
export type WebhookEventType = "match.processed" | "match.created" | "match.updated";

export interface GexWebhookEvent {
  event: WebhookEventType;
  timestamp: string; // ISO date-time
  payload: GexWebhookPayload;
}