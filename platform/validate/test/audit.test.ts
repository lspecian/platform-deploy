import { describe, expect, it } from "vitest";
import { summarizeAudit, shouldFailBuild, BLOCKING_SEVERITIES } from "../src/audit.js";
import { loadWaivers, type WaiverSet } from "../src/waivers.js";

const NOW = new Date("2026-08-27T12:00:00Z");
const NO_WAIVERS: WaiverSet = { active: [], problems: [] };

function waivers(ids: string[]): WaiverSet {
  const expires = new Date(NOW.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const entries = ids
    .map((id) => `  - id: ${id}\n    owner: team-x\n    reason: Under review.\n    expires: ${expires}\n`)
    .join("");
  return loadWaivers(`waivers:\n${entries}`, NOW);
}

function audit(vulnerabilities: Record<string, unknown>): unknown {
  return { vulnerabilities };
}

function vuln(severity: string, url: string, title = "Some vulnerability"): unknown {
  return { severity, fixAvailable: true, via: [{ url, title, source: 1234 }] };
}

describe("severity threshold", () => {
  it.each(["critical", "high"])("blocks on %s", (severity) => {
    const summary = summarizeAudit(
      audit({ lodash: vuln(severity, "https://advisory/1") }),
      NO_WAIVERS,
    );
    expect(summary.blocking).toHaveLength(1);
    expect(shouldFailBuild(summary, NO_WAIVERS)).toBe(true);
  });

  it.each(["moderate", "low", "info"])("reports %s without blocking", (severity) => {
    // Blocking on every moderate finding trains people to re-run the build
    // until it goes green, which is how the critical gate gets ignored too.
    const summary = summarizeAudit(
      audit({ lodash: vuln(severity, "https://advisory/1") }),
      NO_WAIVERS,
    );
    expect(summary.blocking).toHaveLength(0);
    expect(summary.informational).toHaveLength(1);
    expect(shouldFailBuild(summary, NO_WAIVERS)).toBe(false);
  });

  it("treats an unrecognised severity as informational rather than blocking", () => {
    // Failing closed on an unknown severity string would break every build the
    // day npm adds a new one.
    const summary = summarizeAudit(audit({ x: vuln("catastrophic", "https://a/1") }), NO_WAIVERS);
    expect(summary.blocking).toHaveLength(0);
  });

  it("blocks on exactly the documented severities", () => {
    expect([...BLOCKING_SEVERITIES].sort()).toEqual(["critical", "high"]);
  });
});

describe("waivers", () => {
  it("moves a waived finding out of blocking", () => {
    const summary = summarizeAudit(
      audit({ lodash: vuln("critical", "https://advisory/1") }),
      waivers(["https://advisory/1"]),
    );
    expect(summary.blocking).toHaveLength(0);
    expect(summary.waived).toHaveLength(1);
  });

  it("allows a waiver to name the package when the finding is transitive", () => {
    // A transitively inherited vulnerability has no advisory id of its own, so
    // the package name has to be waivable or such findings are unwaivable.
    const summary = summarizeAudit(
      audit({ lodash: { severity: "high", via: ["some-parent"], fixAvailable: false } }),
      waivers(["lodash"]),
    );
    expect(summary.blocking).toHaveLength(0);
    expect(summary.waived).toHaveLength(1);
  });

  it("does not let a waiver cover a different finding", () => {
    const summary = summarizeAudit(
      audit({ lodash: vuln("critical", "https://advisory/1") }),
      waivers(["https://advisory/2"]),
    );
    expect(summary.blocking).toHaveLength(1);
  });

  it("fails the build when a waiver is expired, even with no findings at all", () => {
    // The expired waiver is the failure. Otherwise a suppression outlives its
    // justification unnoticed for as long as the finding happens to be absent.
    const expired = loadWaivers(
      `waivers:\n  - id: OLD\n    owner: team-x\n    reason: Stale.\n    expires: 2020-01-01\n`,
      NOW,
    );
    const summary = summarizeAudit(audit({}), expired);
    expect(summary.blocking).toHaveLength(0);
    expect(shouldFailBuild(summary, expired)).toBe(true);
  });
});

describe("finding extraction", () => {
  it("uses the advisory url as the id so a waiver points somewhere reviewable", () => {
    const summary = summarizeAudit(
      audit({ lodash: vuln("critical", "https://github.com/advisories/GHSA-xxxx") }),
      NO_WAIVERS,
    );
    expect(summary.blocking[0]?.id).toBe("https://github.com/advisories/GHSA-xxxx");
  });

  it("reports one finding per advisory when a package has several", () => {
    const summary = summarizeAudit(
      audit({
        lodash: {
          severity: "critical",
          fixAvailable: true,
          via: [
            { url: "https://a/1", title: "First" },
            { url: "https://a/2", title: "Second" },
          ],
        },
      }),
      NO_WAIVERS,
    );
    expect(summary.blocking).toHaveLength(2);
  });

  it("records whether a fix exists, which is what decides waive-or-upgrade", () => {
    const summary = summarizeAudit(
      audit({ lodash: { severity: "high", fixAvailable: false, via: [{ url: "https://a/1" }] } }),
      NO_WAIVERS,
    );
    expect(summary.blocking[0]?.fixAvailable).toBe(false);
  });

  it("falls back to a package-derived id when the advisory has no url", () => {
    const summary = summarizeAudit(
      audit({ lodash: { severity: "high", via: [{ title: "No url", source: 99 }] } }),
      NO_WAIVERS,
    );
    expect(summary.blocking[0]?.id).toBe("lodash:99");
  });
});

describe("degenerate input", () => {
  it("treats a clean audit as passing", () => {
    const summary = summarizeAudit(audit({}), NO_WAIVERS);
    expect(shouldFailBuild(summary, NO_WAIVERS)).toBe(false);
  });

  it("does not throw on malformed audit output", () => {
    // npm audit output has changed shape across major versions. A crash here
    // reads as a broken pipeline rather than a security finding.
    expect(() => summarizeAudit(null, NO_WAIVERS)).not.toThrow();
    expect(() => summarizeAudit({}, NO_WAIVERS)).not.toThrow();
    expect(() => summarizeAudit("nonsense", NO_WAIVERS)).not.toThrow();
  });
});

describe("npm output variations", () => {
  it("handles a vulnerability with no via field", () => {
    // Shape varies across npm versions; a missing `via` must degrade to a
    // package-level finding rather than dropping the vulnerability silently.
    const summary = summarizeAudit(audit({ lodash: { severity: "critical" } }), NO_WAIVERS);
    expect(summary.blocking).toHaveLength(1);
    expect(summary.blocking[0]?.package).toBe("lodash");
  });

  it("handles an advisory with no title", () => {
    const summary = summarizeAudit(
      audit({ lodash: { severity: "high", via: [{ url: "https://a/1" }] } }),
      NO_WAIVERS,
    );
    expect(summary.blocking[0]?.title).toContain("lodash");
  });

  it("handles a vulnerability with no severity at all", () => {
    const summary = summarizeAudit(audit({ lodash: { via: [{ url: "https://a/1" }] } }), NO_WAIVERS);
    expect(summary.blocking).toHaveLength(0);
    expect(summary.informational).toHaveLength(1);
  });
});
