import { MILESTONES } from "./milestones.js";

// ---------------------------------------------------------------------------
// TODO: rework base race to account for buildings killed
//tweak early bombing lower threshhold
//make tech spread higher threshold
// ---------------------------------------------------------------------------
const FRAMES_PER_SECOND = 30;
const AFUS_DEFS = ["corafus", "armafus", "legafus"]; // e.g. advanced fusion reactor def names
const NUKE_DEFS = ["corsilo", "armsilo", "legsilo"]; // e.g. nuke silo def names, both factions
const ORBITAL_CANNON_DEFS = ["armvulc", "corbuzz", "legstarfall"]; // Ragnarok / Calamity / Starfall def names
const BOMBER_DEFS = ["corshad", "armthund"]; // t1 bomber def names
const BONUS_TECH_DEFS = [
  "armspy",
  "corspy",
  "legspy",
  "cormando",
  "leginfestor",
  "corsktl",
  "armgremlin",
]; // commandos, bedbugs, spy bots, etc — for techSpread bonus
const T3_DEFS = ["corgant", "leggant", "armshltx"]; // any tech-3 gantry, both factions

// Reference wind speed the rush-timing thresholds below are tuned against
// (see MILESTONES descriptions, e.g. "12 mins on 15 average wind speed").
const WIND_BASELINE = 15;

const FRAMES_PER_MINUTE = 60 * FRAMES_PER_SECOND;

export function analyzeMatch(match) {
  const {
    series,
    winner,
    teamA,
    teamB,
    durationMin,
    wind,
    teamDeaths,
    playerCount,
    gamemode,
    spectatorCount,
    mapDraws,
  } = match;
  const last = series[series.length - 1];
  const winnerIsA = winner === "A";
  const winnerFacts = winnerIsA ? teamA.facts : teamB.facts;
  const loserFacts = winnerIsA ? teamB.facts : teamA.facts;
  const isDuel = gamemode === "1" || playerCount === 2;
  const windAverage = wind?.average ?? 0;

  const results = {
    bigBattle: bigBattle(series),
    comeback: comeback(series, winnerIsA),
    backAndForth: backAndForth(series),
    stomp: stomp(series),
    quickForfeit: quickForfeit(loserFacts, playerCount, teamDeaths),
    // baseRace: baseRace(last, durationMin, playerCount),
    guerillaFighters: guerillaFighters(teamA.facts, teamB.facts),
    carpalTunnel: carpalTunnel(
      teamA.facts,
      teamB.facts,
      playerCount,
      durationMin,
    ),
    spaceRace: spaceRace(series),
    earlyBombing: earlyBombing(teamA.facts, teamB.facts),
    nailBiter: nailBiter(winnerFacts, isDuel),
    afusRush: rushMilestone(
      teamA.facts,
      teamB.facts,
      AFUS_DEFS,
      10,
      windAverage,
      playerCount,
      durationMin
    ),
    nukeRush: rushMilestone(
      teamA.facts,
      teamB.facts,
      NUKE_DEFS,
      10,
      windAverage,
      playerCount,
      durationMin
    ),
    gantryRush: rushMilestone(
      teamA.facts,
      teamB.facts,
      T3_DEFS,
      12,
      windAverage,
      playerCount,
      durationMin
    ),
    orbitalCannons: orbitalCannons(
      teamA.facts,
      teamB.facts,
      windAverage,
      playerCount,
      durationMin
    ),
    techSpread: techSpread(teamA.facts, teamB.facts, isDuel),
    goliathDuel: goliathDuel(teamA.facts, teamB.facts, isDuel),
    commanderAttack: commanderAttack(teamA.facts, teamB.facts),
    windyDay: windyDay(windAverage),
    legionMatch: legionMatch(match),
    upset: upset(teamA.skill, teamB.skill, winner),
    peanutGallery: peanutGallery(spectatorCount),
    ecoBoost: ecoBoost(match),
    extraUnits: extraUnits(match),
    modded: modded(match),
    pve: pve(match)
  };

  const flags = {};
  const magnitudes = {};
  for (const key of Object.keys(results)) {
    flags[key] = results[key].flag;
    magnitudes[key] = results[key].magnitude;
  }

  const score = computeScore(magnitudes, durationMin, isDuel);

  return {
    flags,
    magnitudes,
    score,
    // a few raw numbers useful for comparison/debugging, same spirit as before
    details: {
      worstDeficit: results.comeback.worstDeficitVal,
      finalDmgGap: Math.abs((last.dmgA ?? 0) - (last.dmgB ?? 0)),
      skillGap: Math.abs(teamA.skill - teamB.skill),
      momentumShifts: results.backAndForth.shifts,
      highestDamageMinute: results.bigBattle.highestDamageMinute,
      firstAfus: results.afusRush.fastestMinute,
      firstNuke: results.nukeRush.fastestMinute,
      firstT3Minute: results.gantryRush.fastestMinute,
      firstRFLRPC: results.orbitalCannons.rush.fastestMinute,
      commandersLeft: results.nailBiter.remaining,
      uniqueUnits: results.techSpread.diversity,
    },
  };
}

// ---------------------------------------------------------------------------
// Scoring: normalized against the sum of positive weights in MILESTONES, so
// this keeps working correctly if milestones are added/removed/reweighted
// scores are calculated only using the magnitudes, ensuring points are earned for "close enough" to an award
// ---------------------------------------------------------------------------
function computeScore(magnitudes, durationMin, isDuel) {
  const maxPositiveWeight = MILESTONES.reduce((sum, m) => {
    if (excludedKey(isDuel, m.key)) return sum;
    return sum + Math.max(0, m.weight);
  }, 0);

  let raw = 0;
  for (const m of MILESTONES) {
    if (excludedKey(isDuel, m.key)) continue;
    raw += m.weight * magnitudes[m.key];
  }
  let score = maxPositiveWeight > 0 ? (raw / maxPositiveWeight) * 120 : 0;

  // sweet-spot duration bonus (most watchable games run 15-40 min)
  const timeBonus = calculateTimeBonus(durationMin);
  score += timeBonus;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function excludedKey(isDuel, key) {
  if (key === "peanutGallery") return true;
  if (key === "windyDay") return true;
  if (key === "legionMatch") return true;
  if (key === "upset") return true;
  if (key === "goliathDuel" && !isDuel) return true;
  if (key === "nailBiter" && isDuel) return true;
  if (key === "ecoBoost") return true;
  if (key === "extraUnits") return true;
  if (key === "modded") return true;
}

function calculateTimeBonus(durationMin) {
  // Normalize durationMin to a value between 0 and 1
  const normalized = clamp01((durationMin - 10) / (60 - 10));

  // Define the spectrum rules
  if (normalized >= 0 && normalized <= 0.5) {
    // 10-30 minutes: Linear increase from 1 to 8
    // normalized 0 (10 min) -> 1, normalized 0.5 (30 min) -> 8
    return Math.round(normalized * 2 * 7 + 1);
  } else if (normalized > 0.5 && normalized <= (40 - 10) / (60 - 10)) {
    // 30-40 minutes: Fixed value of 8
    return 8;
  } else {
    // 40-60 minutes: Linear decrease from 8 to 1
    // normalized 0.5 (40 min) -> 8, normalized 1 (60 min) -> 1
    return Math.round(8 - (normalized - 0.5) * 2 * 7);
  }
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function frameToMinute(frame) {
  return frame / FRAMES_PER_MINUTE;
}

// ---------------------------------------------------------------------------
// Individual milestone calculations. Each returns { flag, magnitude } (and
// occasionally extra fields, e.g. comeback.worstDeficit, used in `details`).
// ---------------------------------------------------------------------------

/** Sharp declines in army value for BOTH teams in the same interval — a real fight, not a one-sided rout.
 * highest damage being calculated alongside for a tooltip
 */
function bigBattle(series) {
  let bestCombined = 0;
  let bestDamage = 0;
  let highestDamageMinute = 0;
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const cur = series[i];
    const declineA = Math.max(0, prev.armyA - cur.armyA);
    const declineB = Math.max(0, prev.armyB - cur.armyB);
    // require BOTH sides to have lost meaningful army, not just one side getting rolled
    if (declineA > prev.armyA * 0.9 && declineB > prev.armyB * 0.9) {
      bestCombined = Math.max(bestCombined, declineA + declineB);
    }
    //compute highest damage minute by calculating the delta and comparing it to previous max
    const combinedDelta = cur.dmgA - prev.dmgA + (cur.dmgB - prev.dmgB);
    if (combinedDelta > bestDamage) {
      bestDamage = combinedDelta;
      highestDamageMinute = cur.t;
    }
  }
  const flag = bestCombined > 0;
  return {
    flag,
    magnitude: clamp01(bestCombined / 10000),
    highestDamageMinute,
  };
}

/** Winning team was once far behind on army value. */
function comeback(series, winnerIsA) {
  let worstDeficit = 0;
  let worstDeficitVal = 0;
  for (const p of series) {
    const winnerShare = winnerIsA ? p.leadPct : 1 - p.leadPct;
    worstDeficit = Math.max(worstDeficit, 0.5 - winnerShare);

    const winnerArmyVal = winnerIsA ? p.armyA - p.armyB : p.armyB - p.armyA;
    worstDeficitVal = Math.max(worstDeficitVal, 0.5 - winnerArmyVal);
  }
  const flag = worstDeficit >= 0.5;
  return { flag, magnitude: clamp01(worstDeficit / 0.5), worstDeficitVal };
}

/** Constant momentum shifts — count sign changes in army-value lead across the match. */
function backAndForth(series) {
  let shifts = 0;
  let prevSign = null;
  for (const p of series) {
    const sign = Math.sign(p.leadPct - 0.5);
    if (sign !== 0 && prevSign !== null && sign !== prevSign) shifts++;
    if (sign !== 0) prevSign = sign;
  }
  const flag = shifts >= 10;
  return { flag, magnitude: clamp01(shifts / 20), shifts };
}

/** Heavily one-sided — average lead gap across the whole match, not just the final score. */
function stomp(series) {
  const avgGap =
    series.reduce((sum, p) => sum + Math.abs(p.leadPct - 0.4), 0) /
    Math.max(1, series.length);
  const flag = avgGap >= 0.3;
  return { flag, magnitude: avgGap / 0.5 };
}

/**
 * Premature forfeit: the losing team's army and eco was still close to its peak when
 * they died/quit, meaning they resigned rather than got ground down.
 * Weighted more for large teams via the magnitude (bigger games -> more potential to keep fighting).
 */
function quickForfeit(loserFacts, playerCount, teamDeaths) {
  //return 0 if team didnt resign
  if (!teamResigned(teamDeaths))return { flag: false, magnitude: 0 };
  const deathMinute = frameToMinute(loserFacts.deathFrame);
  // approximate "quick" based on current AV and eco vs peak.
  const armyRetainedRatio =
    loserFacts.peakArmyValue > 0
      ? loserFacts.finalArmyValue / loserFacts.peakArmyValue
      : 0;
  const ecoRetainedRatio =
    loserFacts.peakEcoValue > 0
      ? loserFacts.finalEcoValue / loserFacts.peakEcoValue
      : 0;
  //the surrendering team must resign a combined ratio of 1.5 av, ev
  //.85+.85, 1+.7 etc
  const flag = (armyRetainedRatio+ecoRetainedRatio) >= 1.7 && deathMinute > 0;
  const sizeWeight = clamp01(playerCount / 8);
  return { flag, magnitude: clamp01((armyRetainedRatio+ecoRetainedRatio)/2 * sizeWeight) };
}

function teamResigned(teamDeaths) {
  if (!teamDeaths || teamDeaths.length === 0) {
    return false; 
  }
  // Find the death with the highest gameTime
  const highestGameTimeObj = teamDeaths.reduce((prev, current) =>
    (prev.gameTime > current.gameTime) ? prev : current
  );

  // Check if the reason is 2 (resign)
  return highestGameTimeObj.reason === 2;
}

/**
 * significant building damage from both teams in a close time frams.
 * NOTE: this uses total damageDealt (units + structures combined) since the
 * a possible change could be checking damage dealt or taken by both teams without significant army value declines
 */
// function baseRace(last, durationMin, playerCount) {
//   const combinedDmg = (last?.dmgA ?? 0) + (last?.dmgB ?? 0);
//   const perMinutePerPlayer =
//     combinedDmg / Math.max(1, durationMin) / Math.max(1, playerCount);
//   const flag = perMinutePerPlayer >= 400;
//   return { flag, magnitude: clamp01((perMinutePerPlayer - 400) / 800) };
// }

/** High average damage-per-metal-spent (combat efficiency) across both teams. */
function guerillaFighters(factsA, factsB) {
  const efficiency = (f) =>
    f?.totalMetalUsed > 0 ? f.totalDamageDealt / f.totalMetalUsed : 0;
  const avgEfficiency = (efficiency(factsA) + efficiency(factsB)) / 2;
  const flag = avgEfficiency >= 3;
  return { flag, magnitude: avgEfficiency / 7 };
}

/** High average player APM across the match. */
function carpalTunnel(factsA, factsB, playerCount, durationMin) {
  const totalActions =
    (factsA?.totalActions ?? 0) + (factsB?.totalActions ?? 0);
  const apmPerPlayer =
    durationMin > 0 && playerCount > 0
      ? totalActions / durationMin / playerCount
      : 0;
  const flag = apmPerPlayer >= 40;
  return { flag, magnitude: apmPerPlayer / 100 };
}

/** Wind speed higher than baseline. Weight 0 — informational only. */
function windyDay(windAverage) {
  const flag = windAverage > WIND_BASELINE;
  return {
    flag,
    magnitude: clamp01((windAverage - WIND_BASELINE) / WIND_BASELINE),
  };
}

/** Close eco between teams throughout the match. */
function spaceRace(series) {
  const avgEcoGapPct =
    series.reduce((sum, p) => {
      const total = p.ecoA + p.ecoB;
      return sum + (total === 0 ? 0 : Math.abs(p.ecoA - p.ecoB) / total);
    }, 0) / Math.max(1, series.length);
  const flag = avgEcoGapPct <= 0.2;
  return { flag, magnitude: clamp01(1 - avgEcoGapPct / 0.25) };
}

/** Legion detected. Weight 0 — informational only. */
function legionMatch(match) {
  const flag = Boolean(match.legionMatch);
  return { flag, magnitude: flag ? 1 : 0 };
}

/** eco boost options. Weight 0 — informational only. */
function ecoBoost(match) {
  const flag = Boolean(match.ecoBoost);
  return { flag, magnitude: flag ? 1 : 0 };
}

/** extra unit boost options. Weight 0 — informational only. */
function extraUnits(match) {
  const flag = Boolean(match.extraUnits);
  return { flag, magnitude: flag ? 1 : 0 };
}

/** modded game. Weight 0 — informational only. */
function modded(match) {
  const flag = Boolean(match.modded);
  return { flag, magnitude: flag ? 1 : 0 };
}

/** All players on the same team (PvE / co-op vs AI). Weight 0 — informational only. */
function pve(match) {
  const players = match.players ?? [];
  const flag = players.length > 0 && players.every((p) => p.allyTeamID === players[0].allyTeamID);
  return { flag, magnitude: flag ? 1 : 0 };
}

/** At least 5 bombers built by either side before minute 10. */
function earlyBombing(factsA, factsB) {
  const countBefore = (facts) =>
    BOMBER_DEFS.reduce((sum, name) => {
      const frames = facts?.unitsCreatedByDef?.[name]?.frames ?? [];
      return sum + frames.filter((f) => frameToMinute(f) <= 10).length;
    }, 0);
  const maxCount = Math.max(countBefore(factsA), countBefore(factsB));
  const flag = maxCount >= 5;
  return { flag, magnitude: clamp01(maxCount / 10) };
}

/** One commander left on the winning team. Excludes 1v1 duels (trivially always true there). */
function nailBiter(winnerFacts, isDuel) {
  if (isDuel || !winnerFacts)
    return { flag: false, magnitude: 0, remaining: "1 (duel)" };
  const remaining =
    (winnerFacts.commanderUnitIDs?.length ?? 0) -
    (winnerFacts.commanderDeaths?.length ?? 0);
  const flag = remaining === 1;
  const close = remaining === 2;
  return { flag, magnitude: flag ? 1 : close ? 0.5 : 0, remaining };
}

/**
 * Shared logic for AFUs/nuke rush: fastest matching def built by either
 * team, compared against a base-minute threshold that's tightened when wind
 * is above baseline (more energy available -> a "fast" build is faster).
 * gex is unable to differentiate between a scaffold and built building,
 * to improve accuracy, estimate build time based on  scaffold placement
 */
function rushMilestone(
  factsA,
  factsB,
  defNames,
  baseThresholdMin,
  windAverage,
  playerCount,
  durationMin
) {
  if (defNames.length === 0) return { flag: false, magnitude: 0 };
  const fastestFrame = (facts) =>
    defNames.reduce((best, name) => {
      const firstFrame = facts?.unitsCreatedByDef?.[name]?.firstFrame;
      return firstFrame != null ? Math.min(best, firstFrame) : best;
    }, Infinity);
  const scaffoldMinute = frameToMinute(
    Math.min(fastestFrame(factsA), fastestFrame(factsB)),
  );
  if (!Number.isFinite(scaffoldMinute)) return { flag: false, magnitude: 0 };
  //guestimate build time based on scaffold placement time
  const guessedBuildTime = scaffoldMinute >= 15 ? 0.5 : (16 - scaffoldMinute)/2
  const fastestMinute = scaffoldMinute + guessedBuildTime
  if (fastestMinute >= durationMin - 1) return { flag: false, magnitude: 0 };
  //adjust time threshhold for size and wind
  const sizeFactor = 3 - (2 * (playerCount - 2)) / (16 - 2);
  const windFactor = windAverage > 0 ? WIND_BASELINE / windAverage : 1;
  const adjustedThreshold =
    baseThresholdMin * Math.min(2, Math.max(0.5, windFactor)) * sizeFactor;
  const flag = fastestMinute <= adjustedThreshold;
  let magnitude = clamp01(
    1 - (fastestMinute - adjustedThreshold) / adjustedThreshold,
  );
  magnitude = magnitude < .3 ? .3 : magnitude
  return { flag, magnitude, fastestMinute };
}

/** Ragnarok/Calamity/Starfall rush, or 1 built total across the match. */
function orbitalCannons(factsA, factsB, windAverage, playerCount, durationMin) {
  const rush = rushMilestone(
    factsA,
    factsB,
    ORBITAL_CANNON_DEFS,
    30,
    windAverage,
    playerCount,
    durationMin
  );
  const totalBuilt = (facts) =>
    ORBITAL_CANNON_DEFS.reduce(
      (sum, name) => sum + (facts?.unitsCreatedByDef?.[name]?.count ?? 0),
      0,
    );
  const combinedCount = totalBuilt(factsA) + totalBuilt(factsB);
  const flag = rush.flag || combinedCount >= 1;
  const magnitude = Math.max(rush.magnitude, clamp01(combinedCount / 3));
  return { flag, magnitude, rush };
}

/**
 * Unit type diversity, weighted less for large games (more players naturally
 * unlocks more unit types), with a bonus for high-value "flex" units.
 */
function techSpread(factsA, factsB, playerCount) {
  const diversity = Math.max(
    factsA?.unitGroupDiversity ?? 0,
    factsB?.unitGroupDiversity ?? 0,
  );
  const sizeAdjustment = clamp01(2 / Math.max(1, playerCount / 2)); // diminishing weight in bigger games
  const bonusUnits = (facts) =>
    BONUS_TECH_DEFS.reduce(
      (sum, name) => sum + (facts?.unitsCreatedByDef?.[name]?.count ?? 0),
      0,
    );
  const bonusCount = bonusUnits(factsA) + bonusUnits(factsB);

  const flag = diversity >= 8;
  const magnitude = clamp01(
    (diversity / 14) * sizeAdjustment + bonusCount * 0.05,
  );
  return { flag, magnitude: clamp01(magnitude), diversity };
}

/** Both sides reached tech 3 in a 1v1 duel. */
function goliathDuel(factsA, factsB, isDuel) {
  if (!isDuel || T3_DEFS.length === 0) return { flag: false, magnitude: 0 };
  const reachedT3 = (facts) =>
    T3_DEFS.some((name) => (facts?.unitsCreatedByDef?.[name]?.count ?? 0) > 0);
  const flag = reachedT3(factsA) && reachedT3(factsB);
  const singleT3 = reachedT3(factsA) || reachedT3(factsB);
  return { flag, magnitude: flag ? 1 : singleT3 ? 0.5 : 0 };
}

/**
 * One team's commander pushed into the enemy's starting area.
 * NOTE: threshold is in map elmos and approximate — tune against real match
 * data / actual start-box sizes if it's over- or under-firing.
 */
function commanderAttack(factsA, factsB) {
  const APPROACH_THRESHOLD = 400;
  const best = (facts) => facts?.commanderClosestApproachToEnemyBase;
  const closest = [best(factsA), best(factsB)]
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance)[0];
  if (!closest) return { flag: false, magnitude: 0 };
  const flag = closest.distance <= APPROACH_THRESHOLD;
  return {
    flag,
    magnitude: clamp01(1 - closest.distance / APPROACH_THRESHOLD),
  };
}

/** Meaningful skill gap between teams, regardless of outcome. Weight 0 — informational only. */
function upset(skillA, skillB, winner) {
  const skillGap = Math.abs(skillA - skillB);
  const lowerSkillSide = skillA < skillB ? "A" : "B";
  const flag = skillGap >= 5 && winner === lowerSkillSide;
  return { flag, magnitude: clamp01(skillGap / 15) };
}

/* At least 10 spectators in the game */
function peanutGallery(spectatorCount) {
  const flag = spectatorCount >= 10;
  return { 
    flag,
    magnitude: flag ? 1: 0,
  };
}
