// analyzeMatch.js's computeScore only ever reads `key` and `weight` off MILESTONES —
// label/icon/color/description are UI-only, and the original awards.js imports icon
// components from lucide-react, a frontend package with no place in this backend.
// Importing the real awards.js here as-is would fail to resolve that import.
//
// IMPORTANT: this list must stay in sync with the frontend's awards.js MILESTONES by
// hand for now. Worth extracting a small shared file (JSON, or a .ts file with no
// framework imports) that both frontend and backend import from, so key/weight can't
// silently drift out of sync between the two — flagging this rather than solving it
// now since it touches your frontend repo structure too.
export const MILESTONES = [
  { key: "bigBattle", weight: 2 },
  { key: "comeback", weight: 3 },
  { key: "backAndForth", weight: 2 },
  { key: "stomp", weight: -2 },
  { key: "guerillaFighters", weight: 3 },
  { key: "carpalTunnel", weight: 2 },
  { key: "spaceRace", weight: 2 },
  { key: "earlyBombing", weight: 2 },
  { key: "nailBiter", weight: 3 },
  { key: "afusRush", weight: 1 },
  { key: "nukeRush", weight: 2 },
  { key: "gantryRush", weight: 1 },
  { key: "orbitalCannons", weight: 1 },
  { key: "techSpread", weight: 4 },
  { key: "goliathDuel", weight: 5 },
  { key: "commanderAttack", weight: 3 },
  { key: "windyDay", weight: 0 },
  { key: "legionMatch", weight: 0 },
  { key: "upset", weight: 0 },
  { key: "peanutGallery", weight: 0 },
];