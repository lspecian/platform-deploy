import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("falls back to local defaults when nothing is injected", () => {
    const config = loadConfig({});
    expect(config.port).toBe(8080);
    expect(config.host).toBe("0.0.0.0");
    expect(config.environment).toBe("local");
    expect(config.bucketName).toBeUndefined();
  });

  it("reads platform-injected values", () => {
    const config = loadConfig({
      PORT: "9090",
      ENVIRONMENT: "prod",
      SERVICE_NAME: "payments-api",
      APP_VERSION: "1.4.2",
      GIT_COMMIT: "abc1234",
      BUCKET_NAME: "payments-receipts",
    });
    expect(config.port).toBe(9090);
    expect(config.environment).toBe("prod");
    expect(config.serviceName).toBe("payments-api");
    expect(config.version).toBe("1.4.2");
    expect(config.commit).toBe("abc1234");
    expect(config.bucketName).toBe("payments-receipts");
  });

  it("refuses a non-numeric port instead of silently defaulting", () => {
    // A typo in a platform-injected port must fail loudly at boot. Falling back
    // to 8080 would produce a service listening on the wrong port with a green
    // deploy — the worst possible outcome.
    expect(() => loadConfig({ PORT: "eighty-eighty" })).toThrow(/must be an integer/);
  });

  it("treats an empty bucket name as absent rather than as a bucket called ''", () => {
    expect(loadConfig({ BUCKET_NAME: "" }).bucketName).toBeUndefined();
  });
});
