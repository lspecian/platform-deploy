/**
 * ReviewBot — the pull request comment.
 *
 * One comment, updated in place. Not one per push: a bot that appends turns a
 * ten-commit branch into a wall of near-identical comments, and the useful one
 * is never the one you are looking at. The marker below is how the workflow
 * finds its previous comment to edit.
 *
 * What it says matters as much as that it says it. A bot that only repeats what
 * the checks list already shows is noise with extra steps, so this leads with
 * the two things the checks list cannot tell you: what will change in
 * infrastructure, in plain English, and what a failure means you should do.
 */
export const COMMENT_MARKER = "<!-- tarmac-reviewbot -->";

export type GateOutcome = "success" | "failure" | "skipped" | "cancelled";

export interface GateResult {
  readonly name: string;
  readonly outcome: GateOutcome;
  /** Blocking gates stop the merge; reporting gates never do. */
  readonly blocking: boolean;
  /** What to do when it fails. */
  readonly remedy?: string;
}

export interface PlanSummary {
  readonly create: number;
  readonly update: number;
  readonly destroy: number;
  /** Resource addresses being destroyed, which are the ones worth reading. */
  readonly destroyed: readonly string[];
}

export interface ReviewInput {
  readonly gates: readonly GateResult[];
  readonly plan?: PlanSummary;
  readonly image?: { readonly digest: string; readonly sizeMb?: number };
  readonly commit: string;
}

const ICON: Record<GateOutcome, string> = {
  success: "✅",
  failure: "❌",
  skipped: "⏭️",
  cancelled: "⚪",
};

export function blockingFailures(gates: readonly GateResult[]): readonly GateResult[] {
  return gates.filter((g) => g.blocking && g.outcome === "failure");
}

export function canMerge(gates: readonly GateResult[]): boolean {
  return blockingFailures(gates).length === 0;
}

/**
 * Describes a Terraform plan the way a reviewer thinks about it.
 *
 * "3 to add, 1 to change, 1 to destroy" is what Terraform prints and it buries
 * the only line that matters. Destroying a resource is the one thing here that
 * can lose data or drop traffic, so it gets called out by name.
 */
export function describePlan(plan: PlanSummary): string {
  if (plan.create === 0 && plan.update === 0 && plan.destroy === 0) {
    return "No infrastructure changes.";
  }

  const parts: string[] = [];
  if (plan.create > 0) parts.push(`create ${plan.create}`);
  if (plan.update > 0) parts.push(`update ${plan.update}`);
  if (plan.destroy > 0) parts.push(`**destroy ${plan.destroy}**`);

  let text = `This change will ${parts.join(", ")} resource${
    plan.create + plan.update + plan.destroy === 1 ? "" : "s"
  }.`;

  if (plan.destroy > 0) {
    text += `\n\n> ⚠️ **Destroys infrastructure.** Check these are meant to go:\n`;
    text += plan.destroyed.map((address) => `> - \`${address}\``).join("\n");
  }

  return text;
}

export function renderComment(input: ReviewInput): string {
  const failures = blockingFailures(input.gates);
  const mergeable = failures.length === 0;

  const lines: string[] = [COMMENT_MARKER, ""];

  lines.push(
    mergeable
      ? "### ✅ This change can merge"
      : `### ❌ ${failures.length} blocking check${failures.length === 1 ? "" : "s"} failed`,
  );
  lines.push("");

  // Lead with what to do about failures. Someone reading this because their
  // build is red should not have to scroll past a table of passing checks.
  if (!mergeable) {
    for (const failure of failures) {
      lines.push(`**${failure.name}**`);
      if (failure.remedy) lines.push(`> ${failure.remedy}`);
      lines.push("");
    }
  }

  if (input.plan) {
    lines.push("### Infrastructure");
    lines.push("");
    lines.push(describePlan(input.plan));
    lines.push("");
  }

  lines.push("### Checks");
  lines.push("");
  lines.push("| | Check | |");
  lines.push("|---|---|---|");
  for (const gate of input.gates) {
    lines.push(`| ${ICON[gate.outcome]} | ${gate.name} | ${gate.blocking ? "blocking" : "reports only"} |`);
  }
  lines.push("");

  if (input.image) {
    lines.push("### Artifact");
    lines.push("");
    lines.push(`\`${input.image.digest}\``);
    if (input.image.sizeMb !== undefined) lines.push(`${input.image.sizeMb} MB`);
    lines.push("");
    lines.push(
      "Deployed by digest, so the artifact that passed these checks is bit-for-bit the one that reaches production.",
    );
    lines.push("");
  }

  lines.push("---");
  lines.push(
    `<sub>Commit \`${input.commit}\` · reporting-only checks never block · [what blocks and why](docs/gates.md)</sub>`,
  );

  return lines.join("\n");
}
