import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

let publicDir: string;
let app: FastifyInstance | undefined;

beforeAll(() => {
  // Stands in for the Vite build output that the container ships.
  publicDir = mkdtempSync(join(tmpdir(), "tarmac-spa-"));
  writeFileSync(join(publicDir, "index.html"), "<!doctype html><title>spa shell</title>");
  writeFileSync(join(publicDir, "asset.js"), "export const x = 1;");
});

afterAll(() => rmSync(publicDir, { recursive: true, force: true }));
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function makeApp(): FastifyInstance {
  app = buildApp(loadConfig({ LOG_LEVEL: "silent", PUBLIC_DIR: publicDir }));
  return app;
}

describe("SPA serving", () => {
  it("serves the shell at the root", async () => {
    const response = await makeApp().inject("/");
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("spa shell");
  });

  it("serves static assets", async () => {
    const response = await makeApp().inject("/asset.js");
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("export const x");
  });

  it("returns the shell for unknown paths so client-side routing works", async () => {
    // A deep link like /settings/profile must not 404 — the router runs in the
    // browser, so the server has to hand back the shell and let it decide.
    const response = await makeApp().inject("/settings/profile");
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("spa shell");
  });

  it("still returns JSON 404 for unknown API paths", async () => {
    // The SPA fallback must never swallow API 404s: a frontend fetch that gets
    // HTML where it expected JSON produces a baffling parse error instead of a
    // clear 404.
    const response = await makeApp().inject("/api/nope");
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found", path: "/api/nope" });
  });

  it("serves the API normally when static serving is enabled", async () => {
    const response = await makeApp().inject("/api/greeting");
    expect(response.statusCode).toBe(200);
    expect(response.json().message).toBe("hello world");
  });
});
