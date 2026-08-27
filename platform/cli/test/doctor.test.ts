import { describe, expect, it } from "vitest";
import {
  checkRequirement,
  runDoctor,
  isHealthy,
  formatResults,
  REQUIREMENTS,
  type Requirement,
  type CommandRunner,
} from "../src/doctor.js";

const required: Requirement = {
  name: "terraform",
  command: "terraform",
  args: ["--version"],
  remedy: "brew install terraform",
  why: "provisions the infrastructure a service needs",
};

const optional: Requirement = { ...required, name: "opa", command: "opa", optional: true };

const present: CommandRunner = () => "Terraform v1.9.8\non darwin_arm64\n";
const absent: CommandRunner = () => {
  throw new Error("command not found");
};

describe("checking a requirement", () => {
  it("reports an installed tool with its version", () => {
    const result = checkRequirement(required, present);
    expect(result.status).toBe("ok");
    expect(result.detail).toBe("Terraform v1.9.8");
  });

  it("reports a missing required tool as an error", () => {
    expect(checkRequirement(required, absent).status).toBe("error");
  });

  it("reports a missing optional tool as a warning, not an error", () => {
    // An optional tool degrades the experience without stopping anyone
    // shipping. Reporting it as a failure would train people to ignore output
    // from this command entirely.
    expect(checkRequirement(optional, absent).status).toBe("warning");
  });

  it("always includes a remedy when something is wrong", () => {
    // A diagnostic that reports a problem without saying what to do about it
    // has only moved the confusion.
    const result = checkRequirement(required, absent);
    expect(result.remedy).toBe("brew install terraform");
  });

  it("explains why the tool is needed", () => {
    expect(checkRequirement(required, absent).detail).toContain("provisions the infrastructure");
  });
});

describe("the requirement list", () => {
  it("gives every requirement a remedy and a reason", () => {
    // Enforced as a test so a requirement cannot be added without them.
    for (const requirement of REQUIREMENTS) {
      expect(requirement.remedy, `${requirement.name} has no remedy`).toBeTruthy();
      expect(requirement.why, `${requirement.name} has no reason`).toBeTruthy();
    }
  });

  it("requires the tools the road cannot run without", () => {
    const mandatory = REQUIREMENTS.filter((r) => !r.optional).map((r) => r.name);
    expect(mandatory).toEqual(expect.arrayContaining(["docker", "terraform", "node"]));
  });
});

describe("overall health", () => {
  it("is healthy when everything is present", () => {
    expect(isHealthy(runDoctor([required, optional], present))).toBe(true);
  });

  it("is healthy when only optional tools are missing", () => {
    const results = runDoctor([optional], absent);
    expect(isHealthy(results)).toBe(true);
  });

  it("is unhealthy when a required tool is missing", () => {
    expect(isHealthy(runDoctor([required], absent))).toBe(false);
  });
});

describe("output", () => {
  it("prints the remedy beneath the failure", () => {
    const output = formatResults(runDoctor([required], absent));
    expect(output).toContain("terraform");
    expect(output).toContain("brew install terraform");
  });

  it("says so plainly when everything is fine", () => {
    expect(formatResults(runDoctor([required], present))).toContain("Everything the paved road needs");
  });

  it("counts the missing tools so the summary is actionable", () => {
    expect(formatResults(runDoctor([required], absent))).toMatch(/1 required tool\(s\) missing/);
  });
});
