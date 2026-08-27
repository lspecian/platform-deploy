import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadWaiverFile, loadWaivers, isWaived, MAX_WAIVER_DAYS } from "../src/waivers.js";

// Fixed clock. Expiry behaviour is the whole point of this module, so time is
// an input rather than something the tests have to work around.
const NOW = new Date("2026-08-27T12:00:00Z");

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function waiverFile(entries: string): string {
  return `waivers:\n${entries}`;
}

const VALID = waiverFile(`  - id: CVE-2026-1234
    owner: team-payments
    reason: No patched version published yet; mitigated by network policy.
    expires: ${daysFromNow(30)}
`);

describe("a valid waiver", () => {
  it("is active", () => {
    const result = loadWaivers(VALID, NOW);
    expect(result.problems).toEqual([]);
    expect(result.active).toHaveLength(1);
    expect(result.active[0]?.id).toBe("CVE-2026-1234");
  });

  it("suppresses the finding it names", () => {
    const result = loadWaivers(VALID, NOW);
    expect(isWaived("CVE-2026-1234", result)).toBe(true);
  });

  it("does not suppress any other finding", () => {
    // A waiver is for one finding. A waiver that suppressed neighbouring
    // findings would silently widen every time a new one appeared.
    const result = loadWaivers(VALID, NOW);
    expect(isWaived("CVE-2026-9999", result)).toBe(false);
  });
});

describe("expiry", () => {
  it("rejects a waiver that has expired", () => {
    const file = waiverFile(`  - id: CVE-2026-1111
    owner: team-x
    reason: Waiting on upstream.
    expires: ${daysFromNow(-1)}
`);
    const result = loadWaivers(file, NOW);
    expect(result.active).toHaveLength(0);
    expect(result.problems[0]?.message).toMatch(/expired/);
  });

  it("names the owner in the expiry message so the build failure has an addressee", () => {
    const file = waiverFile(`  - id: CVE-2026-1111
    owner: team-payments
    reason: Waiting on upstream.
    expires: ${daysFromNow(-5)}
`);
    const result = loadWaivers(file, NOW);
    expect(result.problems[0]?.message).toContain("team-payments");
  });

  it("rejects a waiver expiring exactly now", () => {
    // Boundary: a waiver expiring this instant is expired, not valid.
    const file = waiverFile(`  - id: CVE-2026-2222
    owner: team-x
    reason: Edge case.
    expires: ${NOW.toISOString()}
`);
    expect(loadWaivers(file, NOW).active).toHaveLength(0);
  });

  it("rejects an expiry beyond the maximum window", () => {
    // Otherwise "expires" becomes decorative: set it to 2099 and the waiver is
    // permanent while still passing every check.
    const file = waiverFile(`  - id: CVE-2026-3333
    owner: team-x
    reason: Indefinite.
    expires: ${daysFromNow(MAX_WAIVER_DAYS + 1)}
`);
    const result = loadWaivers(file, NOW);
    expect(result.active).toHaveLength(0);
    expect(result.problems[0]?.message).toMatch(/exceeds the 90-day maximum/);
  });

  it("accepts an expiry at exactly the maximum window", () => {
    const file = waiverFile(`  - id: CVE-2026-4444
    owner: team-x
    reason: At the limit.
    expires: ${daysFromNow(MAX_WAIVER_DAYS)}
`);
    expect(loadWaivers(file, NOW).active).toHaveLength(1);
  });

  it("rejects an unparseable expiry rather than treating it as far future", () => {
    const file = waiverFile(`  - id: CVE-2026-5555
    owner: team-x
    reason: Typo in the date.
    expires: "not-a-date"
`);
    const result = loadWaivers(file, NOW);
    expect(result.problems[0]?.message).toMatch(/not a valid date/);
  });
});

describe("required fields", () => {
  it.each(["owner", "reason", "expires"])("rejects a waiver with no %s", (field) => {
    const fields: Record<string, string> = {
      owner: "team-x",
      reason: "Because.",
      expires: daysFromNow(10),
    };
    delete fields[field];
    const body = Object.entries(fields)
      .map(([k, v]) => `    ${k}: ${v}`)
      .join("\n");
    const result = loadWaivers(waiverFile(`  - id: CVE-2026-6666\n${body}\n`), NOW);
    expect(result.active).toHaveLength(0);
    expect(result.problems[0]?.message).toContain(field);
  });

  it("rejects a duplicate waiver id", () => {
    // Two entries for one finding means one of them is unreviewed.
    const entry = `  - id: CVE-2026-7777
    owner: team-x
    reason: One.
    expires: ${daysFromNow(10)}
`;
    const result = loadWaivers(waiverFile(entry + entry), NOW);
    expect(result.problems[0]?.message).toMatch(/duplicate/);
  });
});

describe("degenerate files", () => {
  it("treats an absent waiver list as no waivers, not an error", () => {
    // No waiver file is the normal, healthy state and must not fail a build.
    expect(loadWaivers("", NOW)).toEqual({ active: [], problems: [] });
  });

  it("rejects a file that is not a waiver list", () => {
    const result = loadWaivers("something: else\n", NOW);
    expect(result.problems[0]?.message).toMatch(/must contain a `waivers:` list/);
  });

  it("rejects a non-mapping entry", () => {
    const result = loadWaivers("waivers:\n  - just-a-string\n", NOW);
    expect(result.problems[0]?.message).toMatch(/must be a mapping/);
  });

  it("keeps good waivers while reporting bad ones", () => {
    // One malformed entry must not silently discard the rest, or fixing it
    // becomes a game of whack-a-mole.
    const file = waiverFile(`  - id: GOOD
    owner: team-x
    reason: Fine.
    expires: ${daysFromNow(10)}
  - id: BAD
    owner: team-x
    reason: Stale.
    expires: ${daysFromNow(-10)}
`);
    const result = loadWaivers(file, NOW);
    expect(result.active.map((w) => w.id)).toEqual(["GOOD"]);
    expect(result.problems).toHaveLength(1);
  });
});

describe("loadWaiverFile", () => {
  it("reads and validates a file on disk", () => {
    const path = join(tmpdir(), `tarmac-waivers-${process.pid}.yaml`);
    writeFileSync(path, VALID);
    try {
      const result = loadWaiverFile(path, NOW);
      expect(result.problems).toEqual([]);
      expect(result.active).toHaveLength(1);
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("treats a missing file as no waivers", () => {
    // A repository with nothing to waive is the healthy case, not an error.
    expect(loadWaiverFile("/nonexistent/waivers.yaml", NOW)).toEqual({ active: [], problems: [] });
  });
});
