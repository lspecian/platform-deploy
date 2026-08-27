import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Runtime configuration.
 *
 * Everything here is injected by the platform, not chosen by the application.
 * The service manifest (`service.yaml`) is the source of truth; Terraform turns
 * it into the environment variables read below. An application developer never
 * sets these by hand.
 */
export interface Config {
  readonly port: number;
  readonly host: string;
  readonly environment: string;
  readonly serviceName: string;
  /** Build provenance — lets a smoke test assert *which* artifact is running. */
  readonly version: string;
  readonly commit: string;
  /** Bucket declared in service.yaml under `resources.bucket`. */
  readonly bucketName: string | undefined;
  /** Set when talking to the local AWS emulator; unset against real AWS. */
  readonly awsEndpoint: string | undefined;
  readonly awsRegion: string;
  readonly logLevel: string;
  /** Where the built SPA lives. Absent during tests and `tsx watch`. */
  readonly publicDir: string;
}

function intFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return parsed;
}

const DEFAULT_PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: intFromEnv(env, "PORT", 8080),
    // Containers must bind all interfaces; localhost-only would fail the ALB health check.
    host: env.HOST ?? "0.0.0.0",
    environment: env.ENVIRONMENT ?? "local",
    serviceName: env.SERVICE_NAME ?? "hello-world",
    version: env.APP_VERSION ?? "0.0.0-dev",
    commit: env.GIT_COMMIT ?? "unknown",
    bucketName: env.BUCKET_NAME || undefined,
    awsEndpoint: env.AWS_ENDPOINT_URL || undefined,
    awsRegion: env.AWS_REGION ?? "eu-central-1",
    logLevel: env.LOG_LEVEL ?? "info",
    publicDir: env.PUBLIC_DIR ?? DEFAULT_PUBLIC_DIR,
  };
}
