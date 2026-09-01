import { RateLimiter, type RateLimiterLogger, type RateLimiterSnapshot } from "./rateLimiter.js";
import type { GameEventResult, MatchSearchFilters, MatchSummary } from "../types/gex.js";

export interface GexClientOptions {
  baseUrl: string;
  logger?: RateLimiterLogger;
}

export class GexClient {
  private readonly rateLimiter: RateLimiter;

  constructor(private readonly options: GexClientOptions) {
    this.rateLimiter = new RateLimiter(300, 1, options.logger);
  }

  /** Non-consuming read of current rate-limiter state — for periodic sweep-level logging. */
  getRateLimiterSnapshot(): RateLimiterSnapshot {
    return this.rateLimiter.getSnapshot();
  }

  private async getJson<T>(url: string): Promise<T | null> {
    await this.rateLimiter.acquire();

    const res = await fetch(url, {
      referrerPolicy: "strict-origin-when-cross-origin",
      headers: { "User-Agent": "replay-radar-backend (discord: cutelilcucumber)" },
    });


    // gex returns 204 with an empty body for "not processed yet" — this is a valid
    // domain state, not an error, so it must never throw here.
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);

    const body = await res.json();
    return (body?.data ?? body) as T;
  }

  /** GET /api/match/search — one page of match summaries. */
  async searchMatches(filters: MatchSearchFilters): Promise<MatchSummary[]> {
    const { limit, gamemode, minDurationMinutes, minPlayers, minimumAverageOS, startTimeBefore, offset } =
      filters;

    const params = new URLSearchParams({
      limit: String(limit),
      orderBy: "start_time",
      orderByDir: "desc",
      ranked: "true",
      processingAction: "true", // teamStats only exist once the action log is parsed
    });

    if (gamemode) params.set("gamemode", String(gamemode));
    if (minimumAverageOS) params.set("minimumAverageOS", String(minimumAverageOS));
    if (minDurationMinutes) params.set("durationMinimum", String(minDurationMinutes * 60 * 1000));
    if (minPlayers) params.set("playerCountMinimum", String(minPlayers));
    // Inclusive upper bound — the backfill sweeper's cursor. Omitted on the very
    // first sweep (empty DB), which correctly starts from "now".
    if (startTimeBefore) params.set("startTimeBefore", startTimeBefore);
    // Positional offset — only ever used by the recent sweeper's shallow window walk.
    if (offset) params.set("offset", String(offset));

    const result = await this.getJson<MatchSummary[]>(`${this.options.baseUrl}/api/match/search?${params}`);
    return result ?? [];
  }


  /**
   * GET /api/match/{matchId} — single match summary, for on-demand lookup by id
   * (as opposed to /api/match/search, which pages through many). Returns null if gex
   * has no record of this match id at all — a genuine 404 case, distinct from
   * getGameEvent's 204 ("exists, just not processed yet").
   */
  async getMatchById(matchId: string): Promise<MatchSummary | null> {
    const params = new URLSearchParams({
      includePlayers: "true",
      includeTeams: "true",
      includeAllyTeams: "true",
      includeSpectators: "true",
      includeTeamDeaths: "true",
      includeMapDraws: "true"
    });

    return this.getJson<MatchSummary>(`${this.options.baseUrl}/api/match/${matchId}?${params}`);
  }

  /** GET /api/game-event/{id} — returns the discriminated 204-vs-ready result explicitly. */
  async getGameEvent(matchId: string): Promise<GameEventResult> {
    // NOTE: unitResources and factoryUnitCreate are deliberately NOT requested —
    // the pipeline never reads them (buildSeries explicitly voids unitResources),
    // and they're among the largest arrays gex returns for long matches.
    const params = new URLSearchParams({
      includeTeamStats: "true",
      includeExtraStats: "true",
      includeWindUpdates: "true",
      includeUnitsCreated: "true",
      includeUnitsKilled: "true",
      includeUnitDamage: "true",
      includeUnitDefs: "true",
      includeTeamDiedEvents: "true",
      includeCommanderPositionUpdates: "true",
    });

    const data = await this.getJson(`${this.options.baseUrl}/api/game-event/${matchId}?${params}`);

    // This is the whole point of the discriminated union: the caller is now forced,
    // by the type system, to branch on `.status` before it can ever reach `.data`.
    if (data === null) return { status: "notProcessed" };
    return { status: "ready", data: data as any };
  }
}