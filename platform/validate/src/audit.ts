import { isWaived, type WaiverSet } from "./waivers.js";

/**
 * Turns `npm audit --json` into a build decision.
 *
 * The interesting part is not "are there vulnerabilities" — there are always
 * vulnerabilities. It is which of them should stop this pull request. Getting
 * that line wrong in either direction breaks the gate: too strict and people
 * route around it, too loose and it stops meaning anything.
 *
 * This lives in a tested module rather than in a shell pipeline because it is
 * the logic that decides whether a build passes. Pipeline logic that decides
 * things deserves tests as much as application code does.
 */
export type Severity = "info" | "low" | "moderate" | "high" | "critical";

/** Severities that block. Moderate and below are reported and do not fail a build. */
export const BLOCKING_SEVERITIES: ReadonlySet<Severity> = new Set<Severity>(["high", "critical"]);

export interface Finding {
  readonly id: string;
  readonly package: string;
  readonly severity: Severity;
  readonly title: string;
  readonly fixAvailable: boolean;
}

export interface AuditSummary {
  /** Findings that fail the build. */
  readonly blocking: readonly Finding[];
  /** Findings that would block but are covered by an active waiver. */
  readonly waived: readonly Finding[];
  /** Below the blocking threshold: reported, never fatal. */
  readonly informational: readonly Finding[];
}

interface NpmVulnerability {
  readonly name?: string;
  readonly severity?: string;
  readonly via?: unknown;
  readonly fixAvailable?: unknown;
}

function isSeverity(value: unknown): value is Severity {
  return (
    value === "info" ||
    value === "low" ||
    value === "moderate" ||
    value === "high" ||
    value === "critical"
  );
}

/**
 * npm reports each vulnerability's provenance in `via`, which is either a list
 * of advisory objects or a list of package names (when the vulnerability is
 * inherited transitively). Only the object form carries an advisory id.
 */
function findingsFrom(name: string, vulnerability: NpmVulnerability): Finding[] {
  const severity = isSeverity(vulnerability.severity) ? vulnerability.severity : "info";
  const fixAvailable = Boolean(vulnerability.fixAvailable);
  const via = Array.isArray(vulnerability.via) ? vulnerability.via : [];

  const advisories = via.filter(
    (entry): entry is { url?: string; title?: string; source?: number } =>
      typeof entry === "object" && entry !== null,
  );

  if (advisories.length === 0) {
    // Transitive: no advisory of its own. Still a finding — it is still
    // shipping — but identified by package so a waiver can name it.
    return [{ id: name, package: name, severity, title: `vulnerable dependency ${name}`, fixAvailable }];
  }

  return advisories.map((advisory) => ({
    // Prefer the advisory URL as the id: it is stable and a reviewer reading a
    // waiver can follow it to decide whether the justification still holds.
    id: advisory.url ?? `${name}:${advisory.source ?? "unknown"}`,
    package: name,
    severity,
    title: advisory.title ?? `vulnerable dependency ${name}`,
    fixAvailable,
  }));
}

export function summarizeAudit(auditJson: unknown, waivers: WaiverSet): AuditSummary {
  const blocking: Finding[] = [];
  const waived: Finding[] = [];
  const informational: Finding[] = [];

  const vulnerabilities =
    typeof auditJson === "object" && auditJson !== null && "vulnerabilities" in auditJson
      ? ((auditJson as { vulnerabilities?: Record<string, NpmVulnerability> }).vulnerabilities ?? {})
      : {};

  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    for (const finding of findingsFrom(name, vulnerability)) {
      if (!BLOCKING_SEVERITIES.has(finding.severity)) {
        informational.push(finding);
        continue;
      }
      // A waiver may name either the advisory or the package, because a
      // transitive finding has no advisory id of its own to name.
      if (isWaived(finding.id, waivers) || isWaived(finding.package, waivers)) {
        waived.push(finding);
        continue;
      }
      blocking.push(finding);
    }
  }

  return { blocking, waived, informational };
}

/**
 * The build fails on any unwaived high or critical finding, and on any problem
 * with the waiver file itself — an expired waiver is a failure in its own right,
 * whether or not the finding it covered still exists.
 */
export function shouldFailBuild(summary: AuditSummary, waivers: WaiverSet): boolean {
  return summary.blocking.length > 0 || waivers.problems.length > 0;
}
