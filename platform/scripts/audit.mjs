#!/usr/bin/env node
/**
 * Dependency vulnerability gate.
 *
 * Deliberately thin: every decision it makes lives in @tarmac/validate, where
 * it is unit tested. A gate whose logic only exists inside a CI step is a gate
 * nobody can test, and the first time you learn it was wrong is when it lets
 * something through.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { summarizeAudit, shouldFailBuild } from "../validate/dist/audit.js";
import { loadWaiverFile } from "../validate/dist/waivers.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const waivers = loadWaiverFile(join(repoRoot, "platform", "waivers.yaml"));

let auditJson;
try {
  // npm audit exits non-zero whenever anything is found, so a non-zero exit
  // here carries no information — the severity threshold is ours to apply, not
  // npm's. The output is what matters.
  const output = execFileSync("npm", ["audit", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 32 * 1024 * 1024,
  });
  auditJson = JSON.parse(output);
} catch (error) {
  if (error.stdout) {
    auditJson = JSON.parse(error.stdout);
  } else {
    console.error(`Could not run npm audit: ${error.message}`);
    process.exit(1);
  }
}

const summary = summarizeAudit(auditJson, waivers);

const line = (finding) =>
  `  [${finding.severity}] ${finding.package} — ${finding.title}\n      ${finding.id}` +
  (finding.fixAvailable ? "\n      a fix is available: npm audit fix" : "\n      no fix published yet");

if (summary.informational.length > 0) {
  console.log(`${summary.informational.length} finding(s) below the blocking threshold (reported, not fatal)`);
}

if (summary.waived.length > 0) {
  console.log(`\n${summary.waived.length} finding(s) covered by an active waiver:`);
  for (const finding of summary.waived) console.log(line(finding));
}

for (const problem of waivers.problems) {
  console.error(`\nWaiver problem [${problem.id}]: ${problem.message}`);
}

if (summary.blocking.length > 0) {
  console.error(`\n${summary.blocking.length} unwaived high or critical finding(s):\n`);
  for (const finding of summary.blocking) console.error(line(finding));
  console.error(
    "\nFix them, or add a waiver to platform/waivers.yaml with an owner, a reason and an expiry.",
  );
}

if (shouldFailBuild(summary, waivers)) {
  process.exit(1);
}

console.log("\nPASS: no unwaived high or critical vulnerabilities");
