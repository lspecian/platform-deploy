import type { FastifyInstance, FastifyReply } from "fastify";
import { DependencyChecker, isReady } from "../dependencies.js";
import type { Config } from "../config.js";

export function registerHealthRoutes(app: FastifyInstance, config: Config): void {
  const checker = new DependencyChecker(config);

  /**
   * Liveness: is the process alive and able to answer? Deliberately checks
   * nothing else. If liveness depended on a downstream service, an outage in
   * that service would make the orchestrator kill every healthy instance —
   * turning a partial failure into a total one.
   */
  app.get("/healthz", async () => ({ status: "ok" }));

  /**
   * Readiness: should this instance receive traffic right now? This one *does*
   * check dependencies, so a broken instance is pulled from the load balancer
   * without being restarted.
   */
  app.get("/readyz", async (_request, reply: FastifyReply) => {
    const dependencies = await checker.check();
    const ready = isReady(dependencies);
    reply.code(ready ? 200 : 503);
    return { status: ready ? "ready" : "not_ready", dependencies };
  });
}
