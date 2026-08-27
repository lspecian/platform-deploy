import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { loadConfig, type Config } from "./config.js";
import { createLogger } from "./logger.js";
import { registerGreetingRoutes } from "./routes/greeting.js";
import { registerHealthRoutes } from "./routes/health.js";

const CORRELATION_HEADER = "x-correlation-id";

/**
 * Builds the app without starting it, so tests can drive it through
 * `app.inject()` — no ports, no sockets, no sleep-and-hope.
 */
export function buildApp(config: Config = loadConfig()): FastifyInstance {
  const app = Fastify({
    loggerInstance: createLogger(config),
    // Trust the load balancer's X-Forwarded-* headers so logs record the client
    // address rather than the ALB's.
    trustProxy: true,
    genReqId: (req) => (req.headers[CORRELATION_HEADER] as string | undefined) ?? randomUUID(),
  });

  /**
   * A correlation ID that survives the whole request and comes back on the
   * response, so a user reporting "it broke" can hand over one string that
   * finds every log line for their request.
   */
  app.addHook("onRequest", async (request, reply) => {
    reply.header(CORRELATION_HEADER, request.id);
  });

  registerHealthRoutes(app, config);
  registerGreetingRoutes(app, config);

  // The built SPA, when present. Absent during unit tests and `tsx watch`,
  // where Vite serves the frontend instead.
  const publicDir = config.publicDir;
  if (existsSync(publicDir)) {
    app.register(fastifyStatic, { root: publicDir });
    // Client-side routing: unknown non-API paths return the SPA shell, not a 404.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        reply.code(404).send({ error: "not_found", path: request.url });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  return app;
}
