import type { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import { processMatch } from "../pipeline/processMatch";
import { MILESTONES } from "../pipeline/raw/awards";
import type { Prisma } from "../generated/prisma/client";

// Derived from the same MILESTONES list computeScore uses, rather than a fourth
// hand-written copy of the 20 keys — if a milestone is added/removed there, the
// filterable query params and the where-clause builder below follow automatically.
const MILESTONE_KEYS = MILESTONES.map((m: { key: string }) => m.key);

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
} as const;

const listQuerySchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 100 },
    offset: { type: "integer", minimum: 0, default: 0 },
    sortBy: { type: "string", enum: ["startTime", "score"], default: "startTime" },
    sortDir: { type: "string", enum: ["asc", "desc"], default: "desc" },
    gamemode: { type: "integer" },
    playerCountMin: { type: "integer" },
    playerCountMax: { type: "integer" },
    averageOSMin: { type: "number" },
    averageOSMax: { type: "number" },
    scoreMin: { type: "integer" },
    scoreMax: { type: "integer" },
    // Inclusive-before / inclusive-after date range on startTime.
    startTimeAfter: { type: "string", format: "date-time" },
    startTimeBefore: { type: "string", format: "date-time" },
    // One boolean query param per milestone, e.g. ?stomp=true&comeback=false
    ...Object.fromEntries(MILESTONE_KEYS.map((key: string) => [key, { type: "boolean" }])),
  },
  additionalProperties: false,
} as const;

interface ListQuery {
  limit: number;
  offset: number;
  sortBy: "startTime" | "score";
  sortDir: "asc" | "desc";
  gamemode?: number;
  playerCountMin?: number;
  playerCountMax?: number;
  averageOSMin?: number;
  averageOSMax?: number;
  scoreMin?: number;
  scoreMax?: number;
  startTimeAfter?: string;
  startTimeBefore?: string;
  [milestoneKey: string]: unknown;
}

function buildWhere(query: ListQuery): Prisma.MatchWhereInput {
  const where: Prisma.MatchWhereInput = {};

  if (query.gamemode !== undefined) where.gamemode = query.gamemode;

  if (query.playerCountMin !== undefined || query.playerCountMax !== undefined) {
    where.playerCount = {
      ...(query.playerCountMin !== undefined ? { gte: query.playerCountMin } : {}),
      ...(query.playerCountMax !== undefined ? { lte: query.playerCountMax } : {}),
    };
  }

  if (query.averageOSMin !== undefined || query.averageOSMax !== undefined) {
    where.averageOS = {
      ...(query.averageOSMin !== undefined ? { gte: query.averageOSMin } : {}),
      ...(query.averageOSMax !== undefined ? { lte: query.averageOSMax } : {}),
    };
  }

  if (query.scoreMin !== undefined || query.scoreMax !== undefined) {
    where.score = {
      ...(query.scoreMin !== undefined ? { gte: query.scoreMin } : {}),
      ...(query.scoreMax !== undefined ? { lte: query.scoreMax } : {}),
    };
  }

  if (query.startTimeAfter !== undefined || query.startTimeBefore !== undefined) {
    where.startTime = {
      ...(query.startTimeAfter !== undefined ? { gte: new Date(query.startTimeAfter) } : {}),
      ...(query.startTimeBefore !== undefined ? { lte: new Date(query.startTimeBefore) } : {}),
    };
  }

  // Only set a milestone filter when the query param was actually passed — an absent
  // key must mean "don't filter on this", not "filter for false", so this checks
  // `typeof === "boolean"` rather than truthiness.
  for (const key of MILESTONE_KEYS) {
    if (typeof query[key] === "boolean") {
      (where as Record<string, unknown>)[key] = query[key];
    }
  }

  return where;
}

/**
 * Reassembles a DB row into the full record shape the frontend consumes (matching
 * matchData.js's old buildMatchRecord output), pulling map/winner straight off their
 * own columns and everything else out of the JSON blobs already stored.
 */
function toRecord(row: Prisma.MatchGetPayload<Record<string, never>>) {
  return {
    id: row.id,
    map: (row as Record<string, unknown>).map ?? null, // add once your `map` migration lands
    gamemode: String(row.gamemode),
    playerCount: row.playerCount,
    averageOS: row.averageOS,
    durationMin: row.durationMinutes,
    startTime: row.startTime.toISOString(),
    teamA: { name: "Ally Team A", players: [] as unknown[], facts: row.teamAFacts },
    teamB: { name: "Ally Team B", players: [] as unknown[], facts: row.teamBFacts },
    winner: (row as Record<string, unknown>).winner ?? null, // add once your `winner` migration lands
    series: row.series,
    score: row.score,
    analysis: row.analysis,
    ...Object.fromEntries(MILESTONE_KEYS.map((key: string) => [key, (row as Record<string, unknown>)[key]])),
  };
}

export default async function matchesRoutes(fastify: FastifyInstance) {
  fastify.get("/matches", { schema: { querystring: listQuerySchema } }, async (request, reply) => {
    const query = request.query as ListQuery;
    const where = buildWhere(query);

    const [rows, total] = await Promise.all([
      prisma.match.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortDir },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.match.count({ where }),
    ]);

    return reply.code(200).send({
      matches: rows.map(toRecord),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  });

  fastify.post(
    "/matches/:id/analyze",
    { schema: { params: paramsSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      // DB-first: cheap read before ever touching gex.
      const existing = await prisma.match.findUnique({ where: { id } });
      if (existing) {
        return reply.code(200).send(existing);
      }

      // Not in the DB — look it up directly by id, NOT via /api/match/search (that
      // endpoint is for paging through many matches; this is a single, on-demand fetch).
      const summary = await fastify.gex.getMatchById(id);
      if (!summary) {
        return reply.code(404).send({ error: "gex has no match with this id" });
      }

      const result = await processMatch(fastify.gex, summary);

      switch (result) {
        case "inserted": {
          // Re-fetch rather than hand-assemble the response: guarantees what's
          // returned is exactly what's in the DB, not a second, possibly-diverging
          // copy of the same data.
          const created = await prisma.match.findUnique({ where: { id } });
          return reply.code(201).send(created);
        }
        case "notProcessedYet":
          return reply
            .code(202)
            .send({ status: "processing", message: "gex hasn't finished processing this match yet — try again shortly" });
        case "insufficientData":
          // No prior discussion pinned this one down — 422 felt like the closest
          // standard fit ("request was understood, but the match itself can't be
          // analyzed": no team stats, or too short a series). Flag if you'd rather
          // this be a 200 with a null/explanatory body instead.
          return reply
            .code(422)
            .send({ error: "match doesn't have enough data to analyze (no team stats, or too short)" });
        case "alreadyExists": {
          // Race: another request/sweeper inserted it between our findUnique above
          // and processMatch's own check. Just return what's there now.
          const created = await prisma.match.findUnique({ where: { id } });
          return reply.code(200).send(created);
        }
      }
    },
  );
}