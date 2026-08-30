import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { processMatch } from "../pipeline/processMatch";
import { prisma } from "../db/client";
import type { GexWebhookEvent, GexWebhookPayload } from "../types/webhook";
import type { MatchSummary, Gamemode } from "../types/gex";

const WEBHOOK_SECRET = process.env.GEX_WEBHOOK_SECRET ?? "";

if (!WEBHOOK_SECRET) {
  throw new Error("GEX_WEBHOOK_SECRET must be set in environment");
}

function verifySignature(payload: string, signature: string): boolean {
  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function toMatchSummary(payload: GexWebhookPayload): MatchSummary {
  const { match, output } = payload;

  return {
    id: match.id,
    map: match.mapName || match.map,
    gamemode: match.gamemode as Gamemode,
    playerCount: match.playerCount,
    averageOS: match.averageOS,
    durationMs: match.durationMs,
    startTime: match.startTime,
    players: match.players.map((p) => ({
      allyTeamID: p.allyTeamID,
      ...(p.skill !== undefined ? { skill: p.skill } : {}),
    })),
    allyTeams: match.allyTeams.map((a) => ({
      allyTeamID: a.allyTeamID,
      won: a.won,
    })),
    teamDeaths: match.teamDeaths,
    spectators: match.spectators,
    mapDraws: match.mapDraws,
    gameSettings: match.gameSettings,
  };
}

export default async function webhookRoutes(fastify: FastifyInstance) {
  fastify.post<{
    Body: GexWebhookEvent;
    Headers: { "x-gex-signature"?: string };
  }>(
    "/webhook/gex",
    {
      schema: {
        body: {
          type: "object",
          required: ["event", "timestamp", "payload"],
          properties: {
            event: { type: "string" },
            timestamp: { type: "string", format: "date-time" },
            payload: { type: "object" },
          },
        },
      },
      config: {
        rawBody: true,
      },
    },
    async (request, reply) => {
      const signature = request.headers["x-gex-signature"];
      const rawBody = request.body as unknown as Buffer;

      if (!signature) {
        return reply.code(401).send({ error: "Missing x-gex-signature header" });
      }

      if (!verifySignature(rawBody.toString("utf8"), signature)) {
        fastify.log.warn({ signature }, "Invalid webhook signature");
        return reply.code(401).send({ error: "Invalid signature" });
      }

      const event = request.body as GexWebhookEvent;

      fastify.log.info(
        { event: event.event, matchId: event.payload.match.id },
        "Received gex webhook"
      );

      if (event.event !== "match.processed") {
        return reply.code(200).send({ status: "ignored", reason: `Event type ${event.event} not handled` });
      }

      const summary = toMatchSummary(event.payload);

      const result = await processMatch(fastify.gex, summary);

      switch (result) {
        case "inserted": {
          const created = await prisma.match.findUnique({
            where: { id: summary.id },
          });
          return reply.code(201).send({ status: "processed", match: created });
        }
        case "alreadyExists": {
          const existing = await prisma.match.findUnique({
            where: { id: summary.id },
          });
          return reply.code(200).send({ status: "exists", match: existing });
        }
        case "notProcessedYet":
          return reply
            .code(202)
            .send({ status: "retry", message: "gex hasn't finished processing this match yet" });
        case "insufficientData":
          return reply
            .code(422)
            .send({ error: "Match doesn't have enough data to analyze" });
      }
    }
  );
}