import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
      /**
       * Higher floor than the application's. This library is the single point
       * where every manifest is judged; a gap here means a gate that silently
       * approves whatever it does not understand.
       *
       * Branches sit lower than the rest on purpose. The remainder are
       * defensive fallbacks around parser internals that cannot be reached
       * through the public API. The floor is set at what the suite actually
       * achieves so any regression trips it, rather than at a round number
       * that would need contorted tests to satisfy.
       */
      thresholds: { lines: 100, functions: 100, branches: 87, statements: 100 },
    },
  },
});
