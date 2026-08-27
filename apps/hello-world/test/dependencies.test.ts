import { describe, expect, it } from "vitest";
import { DependencyChecker, isReady, type DependencyStatus } from "../src/dependencies.js";
import { loadConfig } from "../src/config.js";

describe("DependencyChecker", () => {
  it("reports the bucket as disabled when the manifest declares none", async () => {
    const statuses = await new DependencyChecker(loadConfig({})).check();
    expect(statuses).toEqual([
      { name: "bucket", state: "disabled", reason: "no bucket declared in service.yaml" },
    ]);
  });

  it("reports failure when a declared bucket is unreachable", async () => {
    const config = loadConfig({
      BUCKET_NAME: "does-not-exist",
      // Port 1 is reserved and nothing listens there, so the SDK fails fast.
      AWS_ENDPOINT_URL: "http://127.0.0.1:1",
      AWS_REGION: "eu-central-1",
    });
    const [status] = await new DependencyChecker(config).check();
    expect(status?.state).toBe("failed");
  });
});

describe("isReady", () => {
  const cases: ReadonlyArray<[string, readonly DependencyStatus[], boolean]> = [
    ["all ok", [{ name: "bucket", state: "ok" }], true],
    ["disabled is still ready", [{ name: "bucket", state: "disabled", reason: "none" }], true],
    ["any failure is not ready", [{ name: "bucket", state: "failed", reason: "boom" }], false],
    [
      "one failure among several is not ready",
      [
        { name: "bucket", state: "ok" },
        { name: "queue", state: "failed", reason: "boom" },
      ],
      false,
    ],
  ];

  it.each(cases)("%s", (_name, statuses, expected) => {
    expect(isReady(statuses)).toBe(expected);
  });
});
