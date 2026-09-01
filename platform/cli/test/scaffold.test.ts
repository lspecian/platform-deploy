import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateManifest } from "@tarmac/validate";
import { generate, scaffold, serviceManifest, workflow, dockerfile } from "../src/scaffold.js";

let scratch: string | undefined;

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

function temp(): string {
  scratch = mkdtempSync(join(tmpdir(), "tarmac-scaffold-"));
  return scratch;
}

const OPTIONS = { name: "payments-api", owner: "team-payments" };

describe("the generated manifest", () => {
  it("passes the platform's own validation", () => {
    // The single most important property of a scaffold: what it produces must
    // pass the first pipeline run. A generator that emits something the gates
    // reject makes the road look broken on a developer's first contact with it.
    const result = validateManifest(serviceManifest(OPTIONS));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("carries the requested name and owner", () => {
    const result = validateManifest(serviceManifest(OPTIONS));
    expect(result.valid && result.manifest.name).toBe("payments-api");
    expect(result.valid && result.manifest.owner).toBe("team-payments");
  });

  it("never scaffolds automatic production approval", () => {
    expect(serviceManifest(OPTIONS)).toContain("approval: required");
  });

  it("uses a non-privileged port by default", () => {
    // Below 1024 needs root, which the container hardening policy forbids.
    const result = validateManifest(serviceManifest(OPTIONS));
    expect(result.valid && result.manifest.runtime.port).toBeGreaterThanOrEqual(1024);
  });
});

describe("the generated pipeline", () => {
  it("calls the reusable workflow rather than inlining the gates", () => {
    // A scaffold that copies pipeline YAML produces a fleet of services that
    // were identical on day one and have diverged by the end of the quarter,
    // and a gate added later reaches none of them.
    const generated = workflow("payments-api");
    expect(generated).toContain("uses:");
    expect(generated).toContain("golden-path.yml");
    expect(generated).not.toContain("gitleaks");
    expect(generated).not.toContain("trivy");
  });
});

describe("the generated Dockerfile", () => {
  const generated = dockerfile(8080);

  it("pins the base image by digest", () => {
    expect(generated).toMatch(/FROM node@sha256:[a-f0-9]{64}/);
  });

  it("runs as a non-root user", () => {
    expect(generated).toContain("USER node");
  });

  it("uses the exec form so SIGTERM reaches the process", () => {
    // The shell form runs under `sh -c`, which does not forward signals, so
    // graceful shutdown never fires and every deploy drops in-flight requests.
    expect(generated).toContain('CMD ["node"');
  });

  it("removes the package manager from the runtime image", () => {
    expect(generated).toContain("rm -rf /usr/local/lib/node_modules/npm");
  });

  it("would pass the container policy: no mutable tag", () => {
    expect(generated).not.toMatch(/FROM node:[\w.-]+\s/);
  });

  it("accepts build provenance, so the smoke test can assert which build is live", () => {
    // Without GIT_COMMIT the service reports "unknown", the deploy's commit
    // assertion can never match, and every scaffolded service fails its own
    // smoke test. Found by deploying a second service.
    expect(generated).toContain("ARG GIT_COMMIT");
    expect(generated).toContain("ENV APP_VERSION");
  });
});

describe("generating files", () => {
  it("produces a small, readable set", () => {
    // A scaffold that emits two hundred files is one nobody reads, so people
    // keep whatever it produced whether or not it fits. Nine is about the limit
    // for something a developer will actually read before their first commit.
    expect(generate(OPTIONS).map((f) => f.path)).toEqual([
      "service.yaml",
      ".github/workflows/ci.yml",
      "README.md",
      "Dockerfile",
      "package.json",
      "tsconfig.json",
      "src/server.ts",
      "test/server.test.ts",
      ".gitignore",
    ]);
  });

  it("emits everything the generated Dockerfile needs to build", () => {
    // The first version emitted a Dockerfile running `npm ci` and
    // `node dist/server.js` into a repository with no package.json and no
    // source. It validated, and it could not build — the failure landed on the
    // developer's first push, which is the worst possible first impression.
    const files = generate(OPTIONS).map((f) => f.path);
    expect(files).toContain("package.json");
    expect(files).toContain("src/server.ts");
  });

  it("points the generated pipeline at a repository that exists", () => {
    // It pointed at a placeholder org, so every scaffolded service failed on
    // its first run with an unresolvable workflow reference.
    expect(workflow("payments-api")).toContain("lspecian/platform-deploy");
  });

  it("names the owning team in the README", () => {
    const readme = generate(OPTIONS).find((f) => f.path === "README.md");
    expect(readme?.contents).toContain("team-payments");
  });
});

describe("writing to disk", () => {
  it("creates every file", () => {
    const target = join(temp(), "payments-api");
    const result = scaffold(target, OPTIONS);

    expect(result.errors).toEqual([]);
    expect(existsSync(join(target, "service.yaml"))).toBe(true);
    expect(existsSync(join(target, ".github", "workflows", "ci.yml"))).toBe(true);
    expect(existsSync(join(target, "Dockerfile"))).toBe(true);
  });

  it("writes a manifest that validates from disk", () => {
    const target = join(temp(), "payments-api");
    scaffold(target, OPTIONS);
    const written = readFileSync(join(target, "service.yaml"), "utf8");
    expect(validateManifest(written).valid).toBe(true);
  });

  it("refuses to overwrite an existing directory", () => {
    const target = temp();
    const result = scaffold(target, OPTIONS);
    expect(result.written).toEqual([]);
    expect(result.errors[0]).toContain("already exists");
  });

  it("writes nothing when the options would produce an invalid manifest", () => {
    // Validate before writing: a half-written repository is worse than none.
    const target = join(temp(), "bad");
    const result = scaffold(target, { name: "Bad_Name", owner: "alice" });
    expect(result.written).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(existsSync(target)).toBe(false);
  });
});
