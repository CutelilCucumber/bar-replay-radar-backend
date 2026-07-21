import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { GexClient } from "../gex/client";

declare module "fastify" {
  interface FastifyInstance {
    gex: GexClient;
  }
}

// fastify-plugin (fp) is required here, not optional style: by default every plugin
// gets its own encapsulation context, so a plain `fastify.decorate` inside an un-wrapped
// plugin would be invisible to sibling plugins (like scannerPlugin, which needs fastify.gex).
// fp() breaks out of that encapsulation deliberately for shared, app-wide resources.
export default fp(async function gexClientPlugin(fastify: FastifyInstance) {
  const gex = new GexClient({ baseUrl: "https://gex.honu.pw" });
  fastify.decorate("gex", gex);
});