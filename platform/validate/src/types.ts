/** A single thing wrong with a manifest, phrased for the person who wrote it. */
export interface ValidationError {
  /** Dotted path to the offending field, e.g. `runtime.port`. Empty for whole-document problems. */
  readonly path: string;
  readonly message: string;
  /** What to actually do about it. Present whenever we can be specific. */
  readonly hint?: string;
}

export interface ServiceManifest {
  readonly apiVersion: "tarmac/v1";
  readonly name: string;
  readonly owner: string;
  readonly description?: string;
  readonly runtime: {
    readonly type: "container";
    readonly port: number;
    readonly cpu?: number;
    readonly memory?: number;
    readonly healthcheck?: { readonly liveness?: string; readonly readiness?: string };
  };
  readonly resources?: {
    readonly bucket?: { readonly name: string; readonly versioning?: boolean };
    readonly queue?: { readonly name: string; readonly fifo?: boolean };
  };
  readonly environments?: Record<string, { readonly replicas?: number; readonly approval?: "required" | "automatic" }>;
  readonly slo?: { readonly availability: number; readonly latency_p95_ms?: number };
}

export type ValidationResult =
  | { readonly valid: true; readonly manifest: ServiceManifest; readonly errors: readonly [] }
  | { readonly valid: false; readonly errors: readonly ValidationError[] };
