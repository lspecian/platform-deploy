import { describe, expect, it } from "vitest";
import {
  findManifestPath,
  resolveService,
  imageReference,
  MANIFEST_FILENAME,
} from "../src/service.js";
import type { ValidationResult } from "@tarmac/validate";

/** A fake filesystem: only these paths exist. */
function fs(...paths: string[]): (path: string) => boolean {
  const set = new Set(paths);
  return (path) => set.has(path);
}

const validManifest = (name = "payments-api"): ValidationResult => ({
  valid: true,
  errors: [],
  manifest: {
    apiVersion: "tarmac/v1",
    name,
    owner: "team-payments",
    runtime: { type: "container", port: 8080 },
  },
});

const invalidManifest: ValidationResult = {
  valid: false,
  errors: [{ path: "owner", message: 'missing required field "owner"' }],
};

describe("finding the manifest", () => {
  it("finds one in the current directory", () => {
    const path = findManifestPath("/repo/services/payments", fs(`/repo/services/payments/${MANIFEST_FILENAME}`));
    expect(path).toBe(`/repo/services/payments/${MANIFEST_FILENAME}`);
  });

  it("walks up to find one in a parent", () => {
    // Commands should work from anywhere inside a service, the way git does.
    // Requiring the service root is the kind of friction that makes people
    // write wrapper scripts, and then the road has a bypass.
    const path = findManifestPath(
      "/repo/services/payments/src/routes",
      fs(`/repo/services/payments/${MANIFEST_FILENAME}`),
    );
    expect(path).toBe(`/repo/services/payments/${MANIFEST_FILENAME}`);
  });

  it("prefers the nearest manifest when several are above", () => {
    // A monorepo has one at the root and one per service. The nearest is the
    // service you are actually in.
    const path = findManifestPath(
      "/repo/services/payments/src",
      fs(`/repo/${MANIFEST_FILENAME}`, `/repo/services/payments/${MANIFEST_FILENAME}`),
    );
    expect(path).toBe(`/repo/services/payments/${MANIFEST_FILENAME}`);
  });

  it("returns nothing when there is none, rather than looping to the root forever", () => {
    expect(findManifestPath("/repo/services/payments", fs())).toBeUndefined();
  });

  it("terminates at the filesystem root", () => {
    expect(findManifestPath("/", fs())).toBeUndefined();
  });
});

describe("resolving a service", () => {
  it("returns the name and owner from the manifest", () => {
    const result = resolveService("/repo/payments", fs(`/repo/payments/${MANIFEST_FILENAME}`), () =>
      validManifest(),
    );
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.service.name).toBe("payments-api");
      expect(result.service.owner).toBe("team-payments");
    }
  });

  it("explains how to create one when none exists", () => {
    const result = resolveService("/somewhere", fs());
    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.reason).toContain("no service.yaml");
      expect(result.hint).toContain("tarmac new");
    }
  });

  it("refuses to act on an invalid manifest rather than guessing", () => {
    // Deploying from a manifest the platform cannot fully parse is how a
    // service ends up running with settings nobody chose.
    const result = resolveService(
      "/repo/payments",
      fs(`/repo/payments/${MANIFEST_FILENAME}`),
      () => invalidManifest,
    );
    expect(result.found).toBe(false);
    if (!result.found) expect(result.hint).toContain("tarmac validate");
  });
});

describe("image references", () => {
  it("derives the image from the service name", () => {
    expect(imageReference("payments-api", "abc1234")).toBe("tarmac/payments-api:abc1234");
  });

  it("gives two services distinct images", () => {
    // The bug this replaces: the CLI hardcoded one service's image, so
    // deploying any other service shipped the wrong container.
    expect(imageReference("orders-api", "abc1234")).not.toBe(
      imageReference("payments-api", "abc1234"),
    );
  });

  it("lets the platform choose the registry, not the application team", () => {
    expect(imageReference("payments-api", "abc1234", "ghcr.io/acme")).toBe(
      "ghcr.io/acme/payments-api:abc1234",
    );
  });
});
