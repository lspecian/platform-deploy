#!/usr/bin/env node
/**
 * Waiver hygiene gate.
 *
 * Runs before the audit so that an expired waiver fails the build on its own
 * merits. If it only ran as part of the audit, a suppression could outlive its
 * justification unnoticed for as long as the finding it covered happened to be
 * absent — and then quietly stop covering anything when it came back.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadWaiverFile } from "../validate/dist/waivers.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const waivers = loadWaiverFile(join(repoRoot, "platform", "waivers.yaml"));

for (const waiver of waivers.active) {
  console.log(`  active: ${waiver.id} (${waiver.owner}, expires ${waiver.expires})`);
}

if (waivers.problems.length === 0) {
  console.log(`PASS: ${waivers.active.length} active waiver(s), none expired or malformed`);
  process.exit(0);
}

console.error(`\n${waivers.problems.length} waiver problem(s):\n`);
for (const problem of waivers.problems) {
  console.error(`  [${problem.id}] ${problem.message}`);
}
process.exit(1);
