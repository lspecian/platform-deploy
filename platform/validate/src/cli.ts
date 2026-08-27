#!/usr/bin/env node
import { validateManifestFile } from "./index.js";

const ESC = String.fromCharCode(27);
const RED = `${ESC}[31m`;
const GREEN = `${ESC}[32m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;

// Respect NO_COLOR and non-TTY output so CI logs stay readable.
const colour = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, text: string): string => (colour ? `${code}${text}${RESET}` : text);

const path = process.argv[2] ?? "service.yaml";
const result = validateManifestFile(path);

if (result.valid) {
  console.log(`${c(GREEN, "PASS")} ${path} is valid`);
  console.log(c(DIM, `  ${result.manifest.name} owned by ${result.manifest.owner}`));
  process.exit(0);
}

console.error(`${c(RED, "FAIL")} ${path} is not valid\n`);
for (const error of result.errors) {
  const where = error.path ? c(DIM, `${error.path}: `) : "";
  console.error(`  ${where}${error.message}`);
  if (error.hint) console.error(c(DIM, `    -> ${error.hint}`));
}
console.error(`\n${result.errors.length} problem${result.errors.length === 1 ? "" : "s"} found.`);
// A non-zero exit is what makes this a gate rather than a suggestion.
process.exit(1);
