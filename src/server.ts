import "dotenv/config"
import { buildApp } from "./app";
import { prisma } from "./db/client";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main() {
  const fastify = buildApp();

  // SIGINT (Ctrl+C locally) / SIGTERM (what most hosts send on redeploy) both trigger
  // fastify.close(), which runs plugins/scanner.ts's onClose hook — that hook stops
  // SCHEDULING new sweeps but lets any sweep already in-flight finish naturally, per
  // the migration plan's "handle 204 as retry-later, don't get blocked" requirement.
  // Only after close() resolves do we disconnect Prisma and actually exit.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      fastify.log.info(`${signal} received, shutting down gracefully`);
      try {
        await fastify.close();
        await prisma.$disconnect();
        process.exit(0);
      } catch (err) {
        fastify.log.error({ err }, "error during shutdown");
        process.exit(1);
      }
    });
  }

  try {
    await fastify.listen({ port: PORT, host: HOST });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();