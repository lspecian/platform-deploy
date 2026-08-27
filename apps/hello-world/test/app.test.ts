import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

let app: FastifyInstance | undefined;

function makeApp(env: NodeJS.ProcessEnv = {}): FastifyInstance {
  app = buildApp(loadConfig({ LOG_LEVEL: "silent", ...env }));
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /api/greeting", () => {
  it("returns the greeting with build provenance", async () => {
    const response = await makeApp({
      SERVICE_NAME: "hello-world",
      ENVIRONMENT: "dev",
      APP_VERSION: "1.2.3",
      GIT_COMMIT: "deadbee",
    }).inject({ method: "GET", url: "/api/greeting" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      message: "hello world",
      service: "hello-world",
      environment: "dev",
      version: "1.2.3",
      commit: "deadbee",
    });
  });

  it("carries the deployed commit, so a smoke test can prove which artifact is live", async () => {
    // This is the assertion the post-deploy smoke test makes. If the endpoint
    // stopped reporting the commit, promotion-by-digest would become unverifiable.
    const response = await makeApp({ GIT_COMMIT: "abc1234" }).inject("/api/greeting");
    expect(response.json().commit).toBe("abc1234");
  });
});

describe("health endpoints", () => {
  it("liveness reports ok without touching dependencies", async () => {
    // Deliberately points at a dead endpoint: liveness must not care.
    const response = await makeApp({
      BUCKET_NAME: "unreachable",
      AWS_ENDPOINT_URL: "http://127.0.0.1:1",
    }).inject("/healthz");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("readiness is ready when no dependency is declared", async () => {
    const response = await makeApp().inject("/readyz");
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("ready");
  });

  it("readiness returns 503 when a declared dependency is unreachable", async () => {
    // The load balancer must pull this instance out rather than send it traffic.
    const response = await makeApp({
      BUCKET_NAME: "unreachable",
      AWS_ENDPOINT_URL: "http://127.0.0.1:1",
    }).inject("/readyz");

    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe("not_ready");
  });
});

describe("correlation id", () => {
  it("echoes a caller-supplied correlation id", async () => {
    const response = await makeApp().inject({
      method: "GET",
      url: "/api/greeting",
      headers: { "x-correlation-id": "trace-me-123" },
    });
    expect(response.headers["x-correlation-id"]).toBe("trace-me-123");
  });

  it("generates one when the caller supplies none", async () => {
    const response = await makeApp().inject("/api/greeting");
    expect(response.headers["x-correlation-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe("unknown routes", () => {
  it("returns JSON 404 for unknown API paths rather than an SPA shell", async () => {
    const response = await makeApp().inject("/api/nope");
    expect(response.statusCode).toBe(404);
  });
});
