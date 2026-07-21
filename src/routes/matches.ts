import type { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import { processMatch } from "../pipeline/processMatch";

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
} as const;

export default async function matchesRoutes(fastify: FastifyInstance) {
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