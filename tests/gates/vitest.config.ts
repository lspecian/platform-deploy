import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["*.test.ts"],
    // These shell out to opa and gitleaks; the default 5s is tight for a cold
    // binary start on a loaded CI runner.
    testTimeout: 30_000,
  },
});
