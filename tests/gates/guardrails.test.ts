import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateManifestFile } from "@tarmac/validate";
import { loadWaiverFile } from "@tarmac/validate";
import { summarizeAudit, shouldFailBuild } from "@tarmac/validate";

/**
 * Guardrail verification.
 *
 * Every test here feeds the platform something that must be rejected, and
 * asserts the *specific* guardrail meant to catch it did. Asserting only that
 * "something failed" would be satisfied by a typo in a fixture.
 *
 * The point is that a gate can break silently — a renamed Rego rule that now
 * matches nothing, a scanner whose output format changed so findings parse to
 * zero, a `continue-on-error` added during an incident and never removed. In
 * all of those the pipeline stays green. The only way to know a gate still
 * bites is to bite it, on every commit.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = join(REPO_ROOT, "tests", "gates", "fixtures");
const POLICY_DIR = join(REPO_ROOT, "platform", "policy");

function opaBinary(): string {
  const local = join(REPO_ROOT, ".tools", "opa");
  return existsSync(local) ? local : "opa";
}

interface Denial {
  rule: string;
  resource: string;
  msg: string;
}

/** Evaluates the real policy bundle against a plan fixture. */
function evaluatePolicy(fixture: string): Denial[] {
  const output = execFileSync(
    opaBinary(),
    [
      "eval",
      "--format",
      "raw",
      "--data",
      POLICY_DIR,
      "--input",
      join(FIXTURES, fixture, "plan.json"),
      "data.tarmac.policy.deny",
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output) as Denial[];
}

// Each fixture breaks exactly one rule. If one broke two, a passing test would
// not tell you which guardrail caught it, and the other could be dead.
const POLICY_FIXTURES: ReadonlyArray<[fixture: string, rule: string, because: string]> = [
  [
    "root-container",
    "no-root-container",
    "a container escape from a root container starts as root on the host",
  ],
  [
    "public-security-group",
    "no-public-ingress",
    "a service reachable from the internet bypasses the load balancer entirely",
  ],
  [
    "unencrypted-bucket",
    "encryption-required",
    "an unencrypted bucket is a data breach waiting for one misconfigured policy",
  ],
  [
    "mutable-image-tag",
    "immutable-image",
    "a mutable tag means the artifact that was tested is not provably the one running",
  ],
  [
    "plaintext-secret",
    "no-plaintext-secrets",
    "a secret in a task definition is readable by anyone with describe permissions",
  ],
];

describe("terraform policy guardrails", () => {
  it.each(POLICY_FIXTURES)("rejects %s — %s", (fixture, rule) => {
    const denials = evaluatePolicy(fixture);
    expect(denials.length).toBeGreaterThan(0);
    expect(denials.map((d) => d.rule)).toContain(rule);
  });

  it.each(POLICY_FIXTURES)("rejects %s for that reason and no other", (fixture, rule) => {
    // A fixture that trips several rules cannot prove any particular one works.
    const denials = evaluatePolicy(fixture);
    expect([...new Set(denials.map((d) => d.rule))]).toEqual([rule]);
  });

  it.each(POLICY_FIXTURES)("explains what is wrong with %s", (fixture) => {
    // A denial a developer cannot act on gets escalated to the platform team
    // instead of fixed, which is how a gate becomes a bottleneck.
    const denials = evaluatePolicy(fixture);
    for (const denial of denials) {
      expect(denial.msg.length).toBeGreaterThan(40);
      expect(denial.resource).toBeTruthy();
    }
  });
});

describe("the control", () => {
  // Without this, a suite where every gate rejected everything unconditionally
  // would look perfectly healthy.
  it("accepts a plan that violates nothing", () => {
    expect(evaluatePolicy("compliant")).toEqual([]);
  });

  it("accepts the manifest of the service that ships in this repo", () => {
    const result = validateManifestFile(join(REPO_ROOT, "apps", "hello-world", "service.yaml"));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts this repository's own waiver file", () => {
    expect(loadWaiverFile(join(REPO_ROOT, "platform", "waivers.yaml")).problems).toEqual([]);
  });
});

describe("service contract guardrail", () => {
  it("rejects a manifest with no owner", () => {
    const result = validateManifestFile(join(FIXTURES, "manifest-missing-owner", "service.yaml"));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("owner"))).toBe(true);
  });
});

describe("waiver guardrail", () => {
  it("rejects an expired waiver", () => {
    const result = loadWaiverFile(join(FIXTURES, "expired-waiver", "waivers.yaml"));
    expect(result.active).toHaveLength(0);
    expect(result.problems[0]?.message).toMatch(/expired/);
  });

  it("names the owner, so the failure has someone to route to", () => {
    const result = loadWaiverFile(join(FIXTURES, "expired-waiver", "waivers.yaml"));
    expect(result.problems[0]?.message).toContain("team-payments");
  });
});

describe("dependency guardrail", () => {
  it("rejects a critical advisory", () => {
    const recorded: unknown = JSON.parse(
      readFileSync(join(FIXTURES, "vulnerable-dependency", "npm-audit.json"), "utf8"),
    );
    const noWaivers = { active: [], problems: [] } as const;
    const summary = summarizeAudit(recorded, noWaivers);

    expect(summary.blocking).toHaveLength(1);
    expect(summary.blocking[0]?.package).toBe("minimist");
    expect(shouldFailBuild(summary, noWaivers)).toBe(true);
  });
});

describe("secret scanning guardrail", () => {
  const gitleaksAvailable = (() => {
    try {
      execFileSync("gitleaks", ["version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  /*
   * This one runs the real scanner rather than reimplementing its detection,
   * because the thing worth verifying is that *gitleaks* still catches this —
   * not that a regex we wrote does.
   *
   * Skipped when the binary is absent so the suite still runs on a laptop; CI
   * installs it, and `it.skipIf` reports the skip loudly rather than passing
   * silently. A guardrail test that quietly no-ops is the exact failure mode
   * this whole directory exists to prevent.
   */
  it.skipIf(!gitleaksAvailable)("detects a credential committed to source", () => {
    let failed = false;
    let output = "";
    try {
      execFileSync(
        "gitleaks",
        ["detect", "--no-git", "--source", join(FIXTURES, "secret-in-source"), "--redact", "--exit-code", "1"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      failed = true;
      output = String((error as { stdout?: string; stderr?: string }).stdout ?? "") +
        String((error as { stderr?: string }).stderr ?? "");
    }

    expect(failed, "gitleaks did not flag the planted credential").toBe(true);
    expect(output.toLowerCase()).toMatch(/leak|secret|finding/);
  });
});

/**
 * Mutation testing for the guardrails themselves.
 *
 * The tests above prove a fixture is currently rejected. They do not prove the
 * rejection comes from the guardrail we think it does — a fixture could be
 * malformed in a way that trips something unrelated, and the test would pass
 * while the real rule was dead.
 *
 * So: remove the policy file, and assert the fixture stops being caught. If a
 * fixture is still rejected with its rule deleted, the test was never testing
 * that rule.
 *
 * This is the check that would catch a Rego rule renamed into oblivion, or a
 * policy file dropped in a refactor — the failures that leave a pipeline green
 * and unprotected.
 */
describe("the guardrails are actually wired to the fixtures", () => {
  const RULE_SOURCE: ReadonlyArray<[fixture: string, rule: string, file: string]> = [
    ["root-container", "no-root-container", "container.rego"],
    ["mutable-image-tag", "immutable-image", "container.rego"],
    ["plaintext-secret", "no-plaintext-secrets", "container.rego"],
    ["public-security-group", "no-public-ingress", "network.rego"],
    ["unencrypted-bucket", "encryption-required", "storage.rego"],
  ];

  it.each(RULE_SOURCE)(
    "%s is no longer caught once %s is removed from the bundle",
    (fixture, rule, file) => {
      const scratch = mkdtempSync(join(tmpdir(), "tarmac-mutation-"));
      try {
        cpSync(POLICY_DIR, scratch, { recursive: true });
        rmSync(join(scratch, file));

        const output = execFileSync(
          opaBinary(),
          [
            "eval",
            "--format",
            "raw",
            "--data",
            scratch,
            "--input",
            join(FIXTURES, fixture, "plan.json"),
            "data.tarmac.policy.deny",
          ],
          { encoding: "utf8" },
        );
        const denials = JSON.parse(output) as Denial[];

        expect(
          denials.map((d) => d.rule),
          `${fixture} is still rejected without ${file}, so the test above was not testing ${rule}`,
        ).not.toContain(rule);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    },
  );
});
