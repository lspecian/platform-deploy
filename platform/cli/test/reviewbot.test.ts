import { describe, expect, it } from "vitest";
import {
  renderComment,
  describePlan,
  canMerge,
  blockingFailures,
  COMMENT_MARKER,
  type GateResult,
} from "../src/reviewbot.js";

const passing: GateResult = { name: "Unit tests", outcome: "success", blocking: true };
const reporting: GateResult = { name: "Bundle size", outcome: "failure", blocking: false };
const failing: GateResult = {
  name: "Secret scan",
  outcome: "failure",
  blocking: true,
  remedy: "Remove the credential and rotate it — it is in git history now.",
};

describe("merge decision", () => {
  it("allows merge when every blocking gate passed", () => {
    expect(canMerge([passing])).toBe(true);
  });

  it("allows merge when only a reporting gate failed", () => {
    // The entire point of the blocking/reporting split. If a reporting gate
    // could block, it would not be a reporting gate.
    expect(canMerge([passing, reporting])).toBe(true);
  });

  it("blocks merge when a blocking gate failed", () => {
    expect(canMerge([passing, failing])).toBe(false);
  });

  it("does not count a skipped gate as a failure", () => {
    expect(canMerge([{ name: "Deploy", outcome: "skipped", blocking: true }])).toBe(true);
  });

  it("lists exactly the blocking failures", () => {
    expect(blockingFailures([passing, reporting, failing]).map((g) => g.name)).toEqual(["Secret scan"]);
  });
});

describe("the comment", () => {
  it("carries the marker so the workflow can find and edit it", () => {
    // Without this the bot appends a new comment per push, and a ten-commit
    // branch becomes a wall of near-identical comments.
    expect(renderComment({ gates: [passing], commit: "abc1234" })).toContain(COMMENT_MARKER);
  });

  it("leads with the remedy when something is blocking", () => {
    // Someone reading this because their build is red should not have to
    // scroll past a table of passing checks to find out what to do.
    const comment = renderComment({ gates: [passing, failing], commit: "abc1234" });
    const remedyAt = comment.indexOf("Remove the credential");
    const tableAt = comment.indexOf("### Checks");
    expect(remedyAt).toBeGreaterThan(-1);
    expect(remedyAt).toBeLessThan(tableAt);
  });

  it("says plainly when a change can merge", () => {
    expect(renderComment({ gates: [passing], commit: "abc1234" })).toContain("can merge");
  });

  it("counts the blocking failures in the heading", () => {
    const comment = renderComment({ gates: [failing], commit: "abc1234" });
    expect(comment).toContain("1 blocking check failed");
  });

  it("marks reporting gates as non-blocking in the table", () => {
    const comment = renderComment({ gates: [reporting], commit: "abc1234" });
    expect(comment).toContain("reports only");
  });

  it("does not claim a failure blocks when it only reports", () => {
    const comment = renderComment({ gates: [passing, reporting], commit: "abc1234" });
    expect(comment).toContain("can merge");
  });

  it("names the commit so the comment is unambiguous after a force push", () => {
    expect(renderComment({ gates: [passing], commit: "deadbee" })).toContain("deadbee");
  });

  it("explains that the digest is what gets promoted", () => {
    const comment = renderComment({
      gates: [passing],
      commit: "abc1234",
      image: { digest: "sha256:abc", sizeMb: 192 },
    });
    expect(comment).toContain("bit-for-bit");
  });
});

describe("describing a plan", () => {
  it("says so when nothing changes", () => {
    expect(describePlan({ create: 0, update: 0, destroy: 0, destroyed: [] })).toBe(
      "No infrastructure changes.",
    );
  });

  it("reads as a sentence rather than terraform's counters", () => {
    const text = describePlan({ create: 3, update: 1, destroy: 0, destroyed: [] });
    expect(text).toContain("create 3");
    expect(text).toContain("update 1");
  });

  it("singularises a one-resource change", () => {
    expect(describePlan({ create: 1, update: 0, destroy: 0, destroyed: [] })).toContain("1 resource.");
  });

  it("calls out destruction prominently and by name", () => {
    // Destroying a resource is the one thing in a plan that can lose data or
    // drop traffic. Terraform's "1 to destroy" buries it at the end of a line.
    const text = describePlan({
      create: 0,
      update: 0,
      destroy: 1,
      destroyed: ["aws_s3_bucket.data"],
    });
    expect(text).toContain("⚠️");
    expect(text).toContain("Destroys infrastructure");
    expect(text).toContain("aws_s3_bucket.data");
  });

  it("lists every resource being destroyed", () => {
    const text = describePlan({
      create: 0,
      update: 0,
      destroy: 2,
      destroyed: ["aws_s3_bucket.data", "aws_ecs_service.main"],
    });
    expect(text).toContain("aws_s3_bucket.data");
    expect(text).toContain("aws_ecs_service.main");
  });
});
