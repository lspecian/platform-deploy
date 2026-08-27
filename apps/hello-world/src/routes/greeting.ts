import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";

export interface Greeting {
  readonly message: string;
  readonly service: string;
  readonly environment: string;
  /** Build provenance. A smoke test asserts this matches the digest it deployed. */
  readonly version: string;
  readonly commit: string;
}

export function registerGreetingRoutes(app: FastifyInstance, config: Config): void {
  app.get("/api/greeting", async (): Promise<Greeting> => {
    return {
      message: "hello world",
      service: config.serviceName,
      environment: config.environment,
      version: config.version,
      commit: config.commit,
    };
  });
}
