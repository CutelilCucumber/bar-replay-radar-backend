import Fastify from "fastify";
import gexClientPlugin from "./plugins/gexClient";
import scannerPlugin from "./plugins/scanner";
import matchesRoutes from "./routes/matches";

/**
 * Builds the app without starting it listening. Kept separate from server.ts so an
 * integration test can `buildApp()` and use `fastify.inject(...)` without a real port.
 */
export function buildApp() {
  const fastify = Fastify({ logger: true });

  // Registration order matters: gexClientPlugin decorates fastify.gex, which both
  // scannerPlugin (the sweepers) and matchesRoutes (the on-demand analyze endpoint)
  // read — it must be registered first, or those reads happen against `undefined`.
  fastify.register(gexClientPlugin);
  fastify.register(scannerPlugin);
  fastify.register(matchesRoutes);

  return fastify;
}