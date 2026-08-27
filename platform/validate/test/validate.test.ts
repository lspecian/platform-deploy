import { describe, expect, it } from "vitest";
import { validateManifest, validateManifestFile } from "../src/index.js";

const VALID = `
apiVersion: tarmac/v1
name: payments-api
owner: team-payments
runtime:
  type: container
  port: 8080
`;

/** Parses the fixture, applies an edit, and re-serialises the minimum needed. */
function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiVersion: "tarmac/v1",
    name: "payments-api",
    owner: "team-payments",
    runtime: { type: "container", port: 8080 },
    ...overrides,
  };
}

function pathsOf(result: ReturnType<typeof validateManifest>): string[] {
  return result.errors.map((e) => e.path);
}

describe("a valid manifest", () => {
  it("passes with only the required fields", () => {
    const result = validateManifest(VALID);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.manifest.name).toBe("payments-api");
  });

  it("passes with the full surface populated", () => {
    const result = validateManifest(
      manifest({
        description: "Handles payments.",
        runtime: {
          type: "container",
          port: 8080,
          cpu: 512,
          memory: 1024,
          healthcheck: { liveness: "/healthz", readiness: "/readyz" },
        },
        resources: {
          bucket: { name: "payments-receipts", versioning: true },
          queue: { name: "payments-events", fifo: false },
        },
        environments: { dev: { replicas: 1, approval: "automatic" }, prod: { replicas: 3 } },
        slo: { availability: 99.9, latency_p95_ms: 300 },
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("required fields", () => {
  it.each(["apiVersion", "name", "owner", "runtime"])("rejects a manifest missing %s", (field) => {
    const doc = manifest();
    delete doc[field];
    const result = validateManifest(doc);
    expect(result.valid).toBe(false);
    // The error must name the field, or the developer has to guess.
    expect(result.errors.some((e) => e.message.includes(field))).toBe(true);
  });

  it("names an owner as missing rather than defaulting one", () => {
    // A service with no owner is a service nobody gets paged for. Silently
    // defaulting to a house team would be worse than failing.
    const doc = manifest();
    delete doc.owner;
    const result = validateManifest(doc);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain("owner");
  });
});

describe("unknown fields are rejected, not ignored", () => {
  it("rejects an unknown top-level field", () => {
    const result = validateManifest(manifest({ replicas: 3 }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('unknown field "replicas"');
  });

  it("rejects a misspelled nested field and points at it", () => {
    // `memoryMb` instead of `memory`. Ignoring it would give a developer a
    // service that silently kept the default size, with a green pipeline.
    const result = validateManifest(
      manifest({ runtime: { type: "container", port: 8080, memoryMb: 2048 } }),
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("runtime.memoryMb");
  });

  it("suggests checking the spelling", () => {
    const result = validateManifest(manifest({ ownr: "team-x" }));
    expect(result.errors[0]?.hint).toMatch(/spelling/);
  });
});

describe("field formats", () => {
  it.each([
    ["Payments-API", "uppercase"],
    ["1payments", "leading digit"],
    ["p", "too short"],
    ["payments_api", "underscore"],
  ])("rejects the service name %s (%s)", (name) => {
    expect(validateManifest(manifest({ name })).valid).toBe(false);
  });

  it("rejects an individual as the owner", () => {
    // People change teams and leave; teams outlive them.
    const result = validateManifest(manifest({ owner: "alice" }));
    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("owner");
  });

  it("rejects a privileged port", () => {
    // Binding below 1024 needs root, which the container hardening policy forbids.
    // Catching it here means a clear message instead of a crash loop in the cluster.
    const result = validateManifest(manifest({ runtime: { type: "container", port: 80 } }));
    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("runtime.port");
  });

  it("rejects an availability target of 100 percent", () => {
    const result = validateManifest(manifest({ slo: { availability: 100 } }));
    expect(result.valid).toBe(false);
  });

  it("rejects an apiVersion the platform does not understand", () => {
    const result = validateManifest(manifest({ apiVersion: "tarmac/v2" }));
    expect(result.valid).toBe(false);
  });
});

describe("semantic checks beyond the schema", () => {
  it("rejects an invalid Fargate cpu/memory pairing", () => {
    // Both values are individually legal; the combination is not. Only a
    // cross-field check catches this before the cloud rejects it at deploy.
    const result = validateManifest(
      manifest({ runtime: { type: "container", port: 8080, cpu: 256, memory: 4096 } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.hint).toContain("512");
  });

  it("accepts a valid Fargate pairing", () => {
    const result = validateManifest(
      manifest({ runtime: { type: "container", port: 8080, cpu: 512, memory: 4096 } }),
    );
    expect(result.valid).toBe(true);
  });

  it("refuses automatic approval for production", () => {
    const result = validateManifest(
      manifest({ environments: { prod: { approval: "automatic" } } }),
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("environments.prod.approval");
  });

  it("allows automatic approval for dev", () => {
    const result = validateManifest(manifest({ environments: { dev: { approval: "automatic" } } }));
    expect(result.valid).toBe(true);
  });

  it("rejects a bucket name with consecutive dots", () => {
    const result = validateManifest(
      manifest({ resources: { bucket: { name: "my..bucket" } } }),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a bucket name shaped like an IP address", () => {
    const result = validateManifest(manifest({ resources: { bucket: { name: "10.0.0.1" } } }));
    expect(result.valid).toBe(false);
  });
});

describe("malformed input", () => {
  it("reports a YAML syntax error with a line number", () => {
    const result = validateManifest("name: [unclosed\n  owner: team-x");
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toMatch(/not valid YAML/);
  });

  it("rejects an empty document", () => {
    expect(validateManifest("").valid).toBe(false);
    expect(validateManifest("# just a comment\n").errors[0]?.message).toBe("manifest is empty");
  });

  it("rejects a top-level list", () => {
    const result = validateManifest("- one\n- two\n");
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toMatch(/mapping at the top level/);
  });

  it("rejects a top-level scalar", () => {
    expect(validateManifest("just a string").valid).toBe(false);
  });
});

describe("reporting", () => {
  it("reports every problem at once rather than one per run", () => {
    // Fixing a manifest one error per run is a miserable loop.
    const result = validateManifest({ apiVersion: "tarmac/v1", name: "BAD_NAME", owner: "alice" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateManifestFile", () => {
  it("validates the reference service manifest that ships in this repo", () => {
    // If the road cannot validate its own example service, nothing else matters.
    const result = validateManifestFile(
      new URL("../../../apps/hello-world/service.yaml", import.meta.url).pathname,
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("gives an actionable message when the file is missing", () => {
    const result = validateManifestFile("/nonexistent/service.yaml");
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.hint).toContain("tarmac new");
  });
});

describe("null and undefined input", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a YAML null document", "~"],
  ])("rejects %s as empty", (_label, input) => {
    const result = validateManifest(input);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toBe("manifest is empty");
  });
});

describe("bounds", () => {
  it("rejects a description longer than the limit", () => {
    const result = validateManifest(manifest({ description: "x".repeat(201) }));
    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("description");
  });

  it("rejects an empty environments block", () => {
    // Declaring `environments: {}` is almost certainly a mistake mid-edit.
    const result = validateManifest(manifest({ environments: {} }));
    expect(result.valid).toBe(false);
  });

  it("rejects a replica count above the cap", () => {
    const result = validateManifest(manifest({ environments: { dev: { replicas: 99 } } }));
    expect(result.valid).toBe(false);
  });

  it("rejects memory below the floor", () => {
    const result = validateManifest(
      manifest({ runtime: { type: "container", port: 8080, memory: 128 } }),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a healthcheck path that is not absolute", () => {
    const result = validateManifest(
      manifest({ runtime: { type: "container", port: 8080, healthcheck: { liveness: "healthz" } } }),
    );
    expect(result.valid).toBe(false);
  });
});
