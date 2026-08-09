import Fastify from "fastify";
import cors from "@fastify/cors";
import gexClientPlugin from "./plugins/gexClient";
import scannerPlugin from "./plugins/scanner";
import matchesRoutes from "./routes/matches";

/**
 * Builds the app without starting it listening. Kept separate from server.ts so an
 * integration test can `buildApp()` and use `fastify.inject(...)` without a real port.
 */
export function buildApp() {
  const fastify = Fastify({ logger: true });

  fastify.register(cors, {
    origin: "http://localhost:5173",
  });

  // Registration order matters: gexClientPlugin decorates fastify.gex, which both
  // scannerPlugin (the sweepers) and matchesRoutes (the on-demand analyze endpoint)
  // read — it must be registered first, or those reads happen against `undefined`.
  fastify.register(gexClientPlugin);
  fastify.register(scannerPlugin);
  fastify.register(matchesRoutes);

  // Plain liveness endpoint — no DB call, deliberately. Northflank's health check just
  // needs to know the process is up and Fastify is answering requests; a DB round trip
  // here would make the health check itself a point of failure (e.g. Supabase blips
  // shouldn't make Northflank think the whole service is down and restart it).
  // Exposes the rate limiter snapshot too — handy to glance at without digging through
  // logs, and gex.getRateLimiterSnapshot() is a non-consuming read, so this is free to
  // hit as often as you like.
  fastify.get("/health", async (request, reply) => {
    return reply.code(200).send({
      status: "ok",
      rateLimiter: fastify.gex?.getRateLimiterSnapshot() ?? null,
    });
  });

  return fastify;
}