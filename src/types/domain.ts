// Shapes produced BY our own pipeline (buildSeries/analyzeMatch), as opposed to
// types/gex.ts which describes what gex itself returns. See the folder-layout
// discussion earlier: anything two or more files import belongs here.

export interface SeriesPoint {
  t: number;
  armyA: number;
  armyB: number;
  ecoA: number;
  ecoB: number;
  dmgA: number;
  dmgB: number;
  metalUsedA: number;
  metalUsedB: number;
  buildPowerA: number;
  buildPowerB: number;
  actionsA: number;
  actionsB: number;
  leadPct: number;
}

export interface CommanderDeath {
  unitID: number;
  frame: number;
}

export interface UnitCreationInfo {
  count: number;
  firstFrame: number;
  frames: number[];
}

export interface TeamFacts {
  allyTeamID: number;
  deathFrame: number | null;
  finalArmyValue: number;
  peakArmyValue: number;
  peakArmyMinute: number | null;
  minArmyValue: number;
  minArmyMinute: number | null;
  totalDamageDealt: number;
  totalMetalUsed: number;
  totalActions: number;
  unitsCreatedByDef: Record<string, UnitCreationInfo>;
  unitGroupDiversity: number;
  commanderUnitIDs: number[];
  commanderDeaths: CommanderDeath[];
  commanderClosestApproachToEnemyBase: { distance: number; frame: number } | null;
}

export interface WindSummary {
  average: number;
  samples: { frame: number; value: number }[];
}

// buildSeries.js's raw return shape. unitDefsById genuinely is a Map here — the JS
// function returns one — so this type says so honestly. It gets converted to a plain
// object (or dropped) at the point it crosses into storage; see pipeline/processMatch.ts.
export interface MatchDataset {
  series: SeriesPoint[];
  teamFacts: { A: TeamFacts; B: TeamFacts };
  wind: WindSummary;
  unitDefsById: Map<number, unknown>;
  legionMatch: boolean;
}

// The input shape analyzeMatch.js expects — assembled from a MatchSummary + MatchDataset
// in processMatch.ts, mirroring buildMatchRecord()'s output in the old matchData.js.
export interface AnalyzableMatch {
  series: SeriesPoint[];
  winner: "A" | "B";
  teamA: { name: string; skill: number; players: unknown[]; facts: TeamFacts };
  teamB: { name: string; skill: number; players: unknown[]; facts: TeamFacts };
  durationMin: number;
  wind: WindSummary;
  teamDeaths: unknown[];
  playerCount: number;
  gamemode: string;
  spectatorCount: number;
  mapDraws: unknown[];
  ecoBoost: boolean;
  extraUnits: boolean;
  legionMatch: boolean;
  modded: boolean;
}

// analyzeMatch.js's return shape. `flags`'s keys are exactly the 20 milestone keys —
// deliberately kept as a Record rather than 20 named fields, since it's spread directly
// into the Prisma `create` call in processMatch.ts and must match schema.prisma's
// boolean columns by key name.
export interface AnalysisResult {
  flags: Record<string, boolean>;
  magnitudes: Record<string, number>;
  score: number;
  details: Record<string, unknown>;
}