import { pino } from "pino";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "./config.js";

/**
 * Structured JSON logs, always. Human-friendly log formats are a local-only
 * luxury; the platform ships these straight to CloudWatch where anything but
 * JSON is unqueryable.
 */
/*
 * Returns Fastify's logger interface rather than pino's concrete `Logger`.
 * Handing Fastify a narrower logger type specialises `FastifyInstance`'s
 * generic parameters, and every function taking a plain `FastifyInstance`
 * then fails to match.
 */
export function createLogger(config: Config): FastifyBaseLogger {
  return pino({
    level: config.logLevel,
    base: {
      service: config.serviceName,
      environment: config.environment,
      version: config.version,
      commit: config.commit,
    },
    formatters: {
      // CloudWatch Insights filters on `level: "error"` far more readably than on `level: 50`.
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"],
      censor: "[redacted]",
    },
  });
}
