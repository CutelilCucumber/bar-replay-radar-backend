import { RateLimiter } from "./rateLimiter";
import type { GameEventResult, MatchSearchFilters, MatchSummary } from "../types/gex.js";

export interface GexClientOptions {
  baseUrl: string;
}

export class GexClient {
  private readonly rateLimiter = new RateLimiter(300, 1);

  constructor(private readonly options: GexClientOptions) {}

  private async getJson<T>(url: string): Promise<T | null> {
    await this.rateLimiter.acquire();

    const res = await fetch(url, {
      referrerPolicy: "strict-origin-when-cross-origin",
      headers: { "User-Agent": "replay-radar-backend (discord: cutelilcucumber)" },
    });
    console.log("Fetched from API with status: ", res.status)

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
   *
   * Assumption worth double-checking against a live match id: this is typed as
   * returning the same MatchSummary shape as one element of /api/match/search's array.
   * If gex's single-match response has extra/different fields, only this method's
   * generic parameter needs adjusting — nothing else depends on the assumption.
   */
  async getMatchById(matchId: string): Promise<MatchSummary | null> {
    const params = new URLSearchParams({
    includeSpectators: "true",
    includeTeamDeaths: "true",
    includeChat: "true",
    includeMapDraws: "true"
    });

    return this.getJson<MatchSummary>(`${this.options.baseUrl}/api/match/${matchId}?${params}`);
  }

  /** GET /api/game-event/{id} — returns the discriminated 204-vs-ready result explicitly. */
  async getGameEvent(matchId: string): Promise<GameEventResult> {
    const params = new URLSearchParams({
      includeTeamStats: "true",
      includeExtraStats: "true",
      includeWindUpdates: "true",
      includeUnitsCreated: "true",
      includeUnitsKilled: "true",
      includeUnitDamage: "true",
      includeUnitDefs: "true",
      includeUnitResources: "true",
      includeFactoryUnitCreate: "true",
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