import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

/**
 * Vulnerability waivers.
 *
 * Every security gate eventually meets a finding that cannot be fixed today —
 * no patch exists, or the fix is a major version bump mid-incident. The choice
 * is between blocking the team indefinitely and letting them suppress it.
 *
 * Both are bad. Blocking gets the gate disabled by someone in a hurry;
 * unbounded suppression means the gate quietly stops covering anything, and
 * nobody notices because the build is green.
 *
 * So a waiver is allowed, but it must name an owner, give a reason, and expire.
 * An expired waiver fails the build — which converts "we suppressed it and
 * forgot" into a scheduled conversation.
 */
export interface Waiver {
  readonly id: string;
  readonly owner: string;
  readonly reason: string;
  /** ISO date. The build fails once this passes. */
  readonly expires: string;
}

export interface WaiverProblem {
  readonly id: string;
  readonly message: string;
}

export interface WaiverSet {
  /** Waivers that are currently in force. */
  readonly active: readonly Waiver[];
  /** Waivers that are malformed or past their expiry. Any of these fails the build. */
  readonly problems: readonly WaiverProblem[];
}

/** Waivers may not be open-ended, and may not be renewed indefinitely by a long date. */
export const MAX_WAIVER_DAYS = 90;

const REQUIRED_FIELDS = ["id", "owner", "reason", "expires"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param now Injected rather than read from the clock, so expiry behaviour is
 *   testable without waiting ninety days or mocking global time.
 */
export function loadWaivers(source: string, now: Date = new Date()): WaiverSet {
  const document: unknown = parseYaml(source);

  if (document === null || document === undefined) {
    return { active: [], problems: [] };
  }

  if (!isRecord(document) || !Array.isArray(document.waivers)) {
    return {
      active: [],
      problems: [{ id: "", message: "waiver file must contain a `waivers:` list" }],
    };
  }

  const active: Waiver[] = [];
  const problems: WaiverProblem[] = [];
  const seen = new Set<string>();

  for (const [index, entry] of document.waivers.entries()) {
    const label = isRecord(entry) && typeof entry.id === "string" ? entry.id : `entry ${index + 1}`;

    if (!isRecord(entry)) {
      problems.push({ id: label, message: "waiver must be a mapping" });
      continue;
    }

    const missing = REQUIRED_FIELDS.filter((field) => typeof entry[field] !== "string" || entry[field] === "");
    if (missing.length > 0) {
      problems.push({
        id: label,
        message: `missing required field(s): ${missing.join(", ")}. A waiver with no owner is a permanent suppression.`,
      });
      continue;
    }

    const waiver = entry as unknown as Waiver;

    if (seen.has(waiver.id)) {
      problems.push({ id: waiver.id, message: "duplicate waiver id" });
      continue;
    }
    seen.add(waiver.id);

    const expires = new Date(waiver.expires);
    if (Number.isNaN(expires.getTime())) {
      problems.push({ id: waiver.id, message: `expiry "${waiver.expires}" is not a valid date` });
      continue;
    }

    if (expires.getTime() <= now.getTime()) {
      problems.push({
        id: waiver.id,
        message: `expired on ${waiver.expires} (owner: ${waiver.owner}). Fix the finding or renew the waiver with a fresh justification.`,
      });
      continue;
    }

    const daysOut = (expires.getTime() - now.getTime()) / 86_400_000;
    if (daysOut > MAX_WAIVER_DAYS) {
      problems.push({
        id: waiver.id,
        message: `expires in ${Math.round(daysOut)} days, which exceeds the ${MAX_WAIVER_DAYS}-day maximum. A long expiry is a permanent suppression wearing a date.`,
      });
      continue;
    }

    active.push(waiver);
  }

  return { active, problems };
}

export function loadWaiverFile(path: string, now: Date = new Date()): WaiverSet {
  try {
    return loadWaivers(readFileSync(path, "utf8"), now);
  } catch {
    // No waiver file is the normal, healthy state.
    return { active: [], problems: [] };
  }
}

/** True when a finding is covered by an active waiver. */
export function isWaived(findingId: string, waivers: WaiverSet): boolean {
  return waivers.active.some((waiver) => waiver.id === findingId);
}
