#!/usr/bin/env node
/**
 * Renders the pull request comment and prints it to stdout.
 *
 * Deliberately thin. Everything it decides -- whether a change can merge, how a
 * plan reads in English -- lives in @tarmac/cli where it is unit tested. A bot
 * whose logic exists only inside a CI step is a bot nobody can test, and the
 * first time you find out it was wrong is when it tells someone a red build is
 * fine.
 *
 * Reads gate outcomes as JSON on argv[2], from the workflow's `needs` context.
 */
import { renderComment } from "../cli/dist/reviewbot.js";

const raw = process.argv[2];
if (!raw) {
  console.error("usage: reviewbot.mjs '<json>'");
  process.exit(1);
}

const needs = JSON.parse(raw);

// Which gates block is a platform decision, documented in docs/gates.md. It is
// declared here rather than inferred so the comment cannot drift from the docs.
const GATES = [
  { key: "quality", name: "Lint, types, tests", blocking: true, remedy: "Run `make test` locally to reproduce." },
  { key: "contract", name: "Service manifest", blocking: true, remedy: "Run `tarmac validate` -- it reports every problem at once." },
  { key: "secrets", name: "Secret scan", blocking: true, remedy: "Remove the credential and rotate it. It is in git history now, so removing it in a later commit is not enough." },
  { key: "dependencies", name: "Dependency vulnerabilities", blocking: true, remedy: "Upgrade the package, or add a waiver in platform/waivers.yaml with an owner, a reason and an expiry." },
  { key: "sast", name: "Static analysis", blocking: true, remedy: "See the job log for the rule and the line it matched." },
  { key: "infrastructure", name: "Terraform and policy", blocking: true, remedy: "The policy output names the resource and what to change." },
  { key: "image", name: "Image build and scan", blocking: true, remedy: "Rebuild against a patched base, or remove the vulnerable package if the runtime does not need it." },
  { key: "integration", name: "Deploy and smoke test", blocking: true, remedy: "The service built but could not serve. Check the emulator logs in the job output." },
  { key: "report", name: "Bundle size and reports", blocking: false },
];

const gates = GATES.filter((g) => needs[g.key]).map((g) => ({
  name: g.name,
  outcome: needs[g.key].result ?? "skipped",
  blocking: g.blocking,
  ...(g.remedy ? { remedy: g.remedy } : {}),
}));

process.stdout.write(
  renderComment({
    gates,
    commit: (process.env.GITHUB_SHA ?? "unknown").slice(0, 7),
  }),
);
