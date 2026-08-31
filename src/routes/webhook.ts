import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { processWebhookPayload } from "../pipeline/processMatch";
import { prisma } from "../db/client";
import type { GexWebhookPayload } from "../types/webhook";

const SIGNATURE_HEADER = "x-gex-signature";

/**
 * Reads the secret lazily, on first real use, instead of throwing at module-import
 * time. Throwing on import means simply importing this file anywhere (a future test,
 * a script) crashes if the env var isn't set yet — same fragility class as the
 * prisma.config.ts build-time crash from earlier in this project.
 */
function getWebhookSecret(): string {
  const secret = process.env.GEX_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("GEX_WEBHOOK_SECRET must be set in environment");
  }
  return secret;
}

function verifySignature(rawBody: string, signature: string): boolean {
  const expected = crypto.createHmac("sha256", getWebhookSecret()).update(rawBody, "utf8").digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(signature, "hex");

  // timingSafeEqual THROWS (not returns false) on mismatched buffer lengths — a
  // forged, truncated, or placeholder-value signature header would crash this into an
  // unhandled rejection and a raw 500, instead of the clean 401 this function is meant
  // to produce. Length check first makes "wrong length" just another "no".
  if (expectedBuf.length !== receivedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

export default async function webhookRoutes(fastify: FastifyInstance) {
  // Captures the raw request bytes before Fastify's default JSON parser consumes them.
  // HMAC verification MUST run against the exact bytes gex sent — re-serializing a
  // parsed object (JSON.stringify(JSON.parse(body))) is not guaranteed to reproduce the
  // original byte sequence (key order, whitespace, number formatting can all differ),
  // which would make every signature check fail even for genuine requests. Self-
  // contained here — no external raw-body plugin dependency required.
  //
  // bodyLimit is set HERE, on the parser itself, not just on routeConfig below — a
  // custom content-type parser's own size enforcement defaults to Fastify's GLOBAL
  // body limit (1MB), and does not reliably inherit a route's bodyLimit option. Without
  // this, a >1MB webhook payload (easily exceeded — full match + GameOutput data) would
  // get rejected by the parser regardless of what routeConfig.bodyLimit says.
  fastify.addContentTypeParser(
    ["application/json", "text/plain"],
    { parseAs: "string", bodyLimit: 50 * 1024 * 1024 }, // 50MB
    (request, body, done) => {
      (request as unknown as { rawBody: string }).rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  const routeConfig = {
    schema: {
      body: {
        type: "object",
        required: ["match", "output"],
        properties: {
          match: { type: "object" },
          output: { type: "object" },
        },
      },
    },
    // gex webhook payloads (match + full GameOutput) can exceed Fastify's 1MB default.
    bodyLimit: 52428800, // 50MB
  };

  async function handleWebhook(request: any, reply: any): Promise<void> {
    const signature = request.headers[SIGNATURE_HEADER] as string | undefined;
    const rawBody = (request as unknown as { rawBody: string }).rawBody;

    if (!signature) {
      fastify.log.info("webhook received without signature, accepting unsigned");
    } else if (!verifySignature(rawBody, signature)) {
      fastify.log.warn("invalid webhook signature");
      return reply.code(401).send({ error: "invalid signature" });
    }

    const { match, output } = request.body as GexWebhookPayload;

    fastify.log.info({ matchId: match.id }, "received gex webhook");

    // The whole point of the webhook: this goes straight to the payload-only path, NOT
    // processMatch (the fetch-based one) — using processMatch here would silently
    // re-fetch getGameEvent/getMatchById from gex for data already sitting right here,
    // spending rate-limited calls for nothing. Flattened into one object because
    // processWebhookPayload's signature expects match-summary fields and GameOutput
    // fields merged at the same level (it internally casts the whole thing to
    // GameOutput for buildMatchDataset) — match/output stay split in gex's actual
    // payload, so the merge happens here at the boundary.
    const result = await processWebhookPayload({
      id: match.id,
      map: match.mapName || match.map,
      gamemode: match.gamemode,
      playerCount: match.playerCount,
      averageOS: match.averageOS,
      durationMs: match.durationMs,
      startTime: match.startTime,
      players: match.players,
      allyTeams: match.allyTeams,
      teamDeaths: match.teamDeaths,
      spectators: match.spectators,
      mapDraws: match.mapDraws,
      gameSettings: match.gameSettings,
      ...output, // teamStats, unitsCreated, unitDefinitions, windUpdates, etc.
    });

    switch (result) {
      case "inserted": {
        const created = await prisma.match.findUnique({ where: { id: match.id } });
        fastify.log.info({ matchId: match.id, result: "inserted" }, "webhook match inserted");
        return reply.code(201).send({ status: "processed", match: created });
      }
      case "alreadyExists": {
        const existing = await prisma.match.findUnique({ where: { id: match.id } });
        fastify.log.info({ matchId: match.id, result: "alreadyExists" }, "webhook match already exists");
        return reply.code(200).send({ status: "exists", match: existing });
      }
      case "insufficientData":
        fastify.log.warn({
          matchId: match.id,
          result: "insufficientData",
          teamStatsLen: output.teamStats?.length,
          allyTeamsLen: match.allyTeams?.length,
          playersLen: match.players?.length,
        }, "webhook insufficient data");
        return reply.code(200).send({ status: "insufficientData" });
      case "notProcessedYet":
        return reply.code(202).send({ status: "notProcessedYet" });
    }
  }

  fastify.post("/webhook/gex", routeConfig, handleWebhook);
  // Trailing-slash variant some webhook providers send. Alternative: set
  // `ignoreTrailingSlash: true` once on the Fastify() constructor in app.ts instead of
  // duplicating the route registration — worth doing if more routes need this later.
  fastify.post("/webhook/gex/", routeConfig, handleWebhook);
}