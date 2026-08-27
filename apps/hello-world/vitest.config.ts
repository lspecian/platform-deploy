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
      // The server entrypoint binds a socket and installs signal handlers;
      // exercising it in-process would test Node, not us. app.ts is covered
      // instead, which is where the behaviour lives.
      exclude: ["src/server.ts"],
      /**
       * The coverage floor is a pipeline gate, not a vanity metric. It is set
       * where the suite genuinely sits so that a drop is a real regression
       * rather than noise. Raising it is a deliberate act; lowering it should
       * require an argument in a pull request.
       */
      thresholds: { lines: 95, functions: 100, branches: 90, statements: 95 },
    },
  },
});
