import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import type { Config } from "./config.js";

export type DependencyStatus =
  | { readonly name: string; readonly state: "ok" }
  | { readonly name: string; readonly state: "disabled"; readonly reason: string }
  | { readonly name: string; readonly state: "failed"; readonly reason: string };

/**
 * Readiness has to mean something. A `/readyz` that returns 200 unconditionally
 * is worse than no readiness probe at all: the load balancer will happily route
 * traffic to an instance that cannot serve it.
 *
 * So this actually reaches the bucket declared in `service.yaml`. If no bucket
 * is declared the dependency reports `disabled` — honest, and still ready —
 * rather than silently passing.
 */
export class DependencyChecker {
  readonly #config: Config;
  readonly #s3: S3Client | undefined;

  constructor(config: Config) {
    this.#config = config;
    this.#s3 = config.bucketName
      ? new S3Client({
          region: config.awsRegion,
          ...(config.awsEndpoint ? { endpoint: config.awsEndpoint, forcePathStyle: true } : {}),
        })
      : undefined;
  }

  async check(): Promise<readonly DependencyStatus[]> {
    return [await this.#checkBucket()];
  }

  async #checkBucket(): Promise<DependencyStatus> {
    const bucket = this.#config.bucketName;
    if (!bucket || !this.#s3) {
      return { name: "bucket", state: "disabled", reason: "no bucket declared in service.yaml" };
    }
    try {
      await this.#s3.send(new HeadBucketCommand({ Bucket: bucket }));
      return { name: "bucket", state: "ok" };
    } catch (error) {
      return {
        name: "bucket",
        state: "failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function isReady(statuses: readonly DependencyStatus[]): boolean {
  return statuses.every((s) => s.state !== "failed");
}
