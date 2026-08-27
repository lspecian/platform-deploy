import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp(config);

/**
 * Graceful shutdown. Without it, a rolling deploy drops in-flight requests:
 * the container dies the instant it is told to, mid-response.
 */
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, "shutting down");
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ error }, "error during shutdown");
        process.exit(1);
      },
    );
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error({ error }, "failed to start");
  process.exit(1);
}
