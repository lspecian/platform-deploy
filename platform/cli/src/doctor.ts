import { execFileSync } from "node:child_process";

/**
 * `tarmac doctor`
 *
 * Diagnoses a broken local setup and tells you how to fix it.
 *
 * This exists because of what actually happens when a developer's environment
 * is wrong: they get a stack trace from whichever tool failed first, paste it
 * into a chat channel, and wait. That is the platform team's support burden and
 * the developer's afternoon. A check that names the missing thing and prints
 * the command to install it converts that into fifteen seconds.
 *
 * Every check therefore carries a remedy. A diagnostic that reports a problem
 * without saying what to do about it has only moved the confusion.
 */
export type CheckStatus = "ok" | "warning" | "error";

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
  /** What to actually run or do. Required for anything not ok. */
  readonly remedy?: string;
}

export interface Requirement {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  /** Optional tools warn instead of failing. */
  readonly optional?: boolean;
  readonly remedy: string;
  readonly why: string;
}

export const REQUIREMENTS: readonly Requirement[] = [
  {
    name: "docker",
    command: "docker",
    args: ["--version"],
    remedy: "Install Docker Desktop: https://docs.docker.com/get-docker/",
    why: "runs the local cloud emulator and builds service images",
  },
  {
    name: "terraform",
    command: "terraform",
    args: ["--version"],
    remedy: "brew install terraform",
    why: "provisions the infrastructure a service needs",
  },
  {
    name: "node",
    command: "node",
    args: ["--version"],
    remedy: "Install Node 22 or newer: https://nodejs.org",
    why: "builds and runs the service",
  },
  {
    name: "aws",
    command: "aws",
    args: ["--version"],
    remedy: "brew install awscli",
    why: "registers deploy targets against the emulator",
  },
  {
    name: "opa",
    command: "opa",
    args: ["version"],
    optional: true,
    remedy: "make tools (downloads it into .tools/)",
    why: "runs the infrastructure policy checks locally, before CI does",
  },
];

export type CommandRunner = (command: string, args: readonly string[]) => string;

const defaultRunner: CommandRunner = (command, args) =>
  execFileSync(command, [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

export function checkRequirement(requirement: Requirement, run: CommandRunner = defaultRunner): CheckResult {
  try {
    const output = run(requirement.command, requirement.args);
    return {
      name: requirement.name,
      status: "ok",
      detail: output.split("\n")[0]?.trim() ?? "installed",
    };
  } catch {
    return {
      name: requirement.name,
      // An optional tool that is missing degrades the experience; it does not
      // stop anyone shipping, so it must not read like a failure.
      status: requirement.optional ? "warning" : "error",
      detail: `not found — ${requirement.why}`,
      remedy: requirement.remedy,
    };
  }
}

export function runDoctor(
  requirements: readonly Requirement[] = REQUIREMENTS,
  run: CommandRunner = defaultRunner,
): readonly CheckResult[] {
  return requirements.map((requirement) => checkRequirement(requirement, run));
}

/** Only a hard error is worth a non-zero exit. Warnings are advice. */
export function isHealthy(results: readonly CheckResult[]): boolean {
  return !results.some((result) => result.status === "error");
}

export function formatResults(results: readonly CheckResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    const marker = result.status === "ok" ? "ok  " : result.status === "warning" ? "warn" : "FAIL";
    lines.push(`  ${marker}  ${result.name.padEnd(12)} ${result.detail}`);
    if (result.remedy) lines.push(`              -> ${result.remedy}`);
  }

  const failures = results.filter((r) => r.status === "error");
  lines.push("");
  lines.push(
    failures.length === 0
      ? "Everything the paved road needs is present."
      : `${failures.length} required tool(s) missing. Install them and run \`tarmac doctor\` again.`,
  );
  return lines.join("\n");
}
