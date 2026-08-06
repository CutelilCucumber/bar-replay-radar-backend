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

  // No `await` here, deliberately — same as the three registrations below. Fastify
  // queues every fastify.register(...) call via its internal loader (avvio) and
  // resolves them all, in order, before the server starts accepting requests. Awaiting
  // register() individually at the top level isn't wrong exactly, but it requires
  // buildApp() itself to become async, which then requires server.ts to await it too —
  // more churn than the fix needs, since plain unawaited register() already guarantees
  // correct ordering here.
  fastify.register(cors, {
    origin: "http://localhost:5173",
  });

  // Registration order matters: gexClientPlugin decorates fastify.gex, which both
  // scannerPlugin (the sweepers) and matchesRoutes (the on-demand analyze endpoint)
  // read — it must be registered first, or those reads happen against `undefined`.
  fastify.register(gexClientPlugin);
  fastify.register(scannerPlugin);
  fastify.register(matchesRoutes);

  return fastify;
}