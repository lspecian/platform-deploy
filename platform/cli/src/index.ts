#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifestFile } from "@tarmac/validate";
import { runDoctor, formatResults, isHealthy } from "./doctor.js";
import { scaffold } from "./scaffold.js";
import { resolveService, imageReference } from "./service.js";

/**
 * The developer-facing surface of the paved road.
 *
 * Every command here is a thin wrapper over something a developer could run by
 * hand. That is the point: the CLI is a set of shortcuts with good error
 * messages, not a layer that hides what is happening. A developer who wants to
 * know what `tarmac deploy` did can read one shell script, and a developer
 * debugging at 3am is never blocked by an abstraction they cannot see through.
 */

const ESC = String.fromCharCode(27);
const colour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string, text: string): string =>
  colour ? `${ESC}[${code}m${text}${ESC}[0m` : text;
const bold = (t: string) => paint("1", t);
const dim = (t: string) => paint("2", t);
const red = (t: string) => paint("31", t);
const green = (t: string) => paint("32", t);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function run(command: string, args: string[], cwd: string = REPO_ROOT): number {
  try {
    execFileSync(command, args, { stdio: "inherit", cwd });
    return 0;
  } catch (error) {
    return typeof (error as { status?: number }).status === "number"
      ? ((error as { status: number }).status ?? 1)
      : 1;
  }
}

function usage(): void {
  console.log(`${bold("tarmac")} — the paved road

${bold("Getting started")}
  tarmac new <name> --owner team-x    scaffold a service wired to the road
  tarmac doctor                       check your local setup and how to fix it

${bold("Day to day")}
  tarmac dev                          run the stack locally with hot reload
  tarmac validate [manifest]          the same check CI runs
  tarmac test                         run every test suite

${bold("Shipping")}
  tarmac deploy [env]                 deploy, smoke test, roll back on failure
  tarmac status [env]                 what is deployed where
  tarmac logs                         tail the running service
  tarmac rollback [env]               return to the previous version

${dim("Environments: dev (default), staging, prod")}
`);
}

/** Resolves the service being worked on, or explains why it could not. */
function currentService(): ReturnType<typeof resolveService> {
  const resolution = resolveService(process.cwd());
  if (!resolution.found) {
    console.error(`${red("No service here")}\n`);
    console.error(`  ${resolution.reason}`);
    console.error(dim(`    -> ${resolution.hint}`));
  }
  return resolution;
}

function deploy(environment: string): number {
  const resolution = currentService();
  if (!resolution.found) return 1;
  const { name, manifestPath } = resolution.service;

  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  }).trim();
  const image = imageReference(name, commit);

  console.log(`${bold("Deploying")} ${name} ${dim(image)} to ${environment}\n`);
  process.env.EXPECT_COMMIT = commit;
  return run(join(REPO_ROOT, "platform", "scripts", "deploy.sh"), [
    environment,
    "local",
    image,
    manifestPath,
  ]);
}

function status(environment: string): number {
  const resolution = currentService();
  if (!resolution.found) return 1;
  const { name } = resolution.service;

  try {
    const output = execFileSync(
      "terraform",
      ["-chdir=infra", "output", "-json"],
      {
        encoding: "utf8",
        cwd: REPO_ROOT,
        // State is keyed on service and environment, so the workspace has to be
        // too. Reading the environment's workspace alone would report another
        // service's deployment as if it were this one's.
        env: { ...process.env, TF_WORKSPACE: `${name}-${environment}` },
      },
    );
    const outputs = JSON.parse(output) as Record<string, { value: unknown }>;
    if (Object.keys(outputs).length === 0) throw new Error("empty");

    console.log(`${bold(name)} in ${environment}`);
    console.log(`  url      ${String(outputs.service_url?.value ?? "unknown")}`);
    console.log(`  image    ${String(outputs.image?.value ?? "unknown")}`);
    console.log(`  cluster  ${String(outputs.cluster_name?.value ?? "unknown")}`);
    return 0;
  } catch {
    console.log(`${name} is not deployed to ${environment}`);
    console.log(dim("  run `tarmac deploy` to bring it up"));
    return 0;
  }
}

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      usage();
      return 0;

    case "doctor": {
      const results = runDoctor();
      console.log(`${bold("tarmac doctor")}\n`);
      console.log(formatResults(results));
      return isHealthy(results) ? 0 : 1;
    }

    case "new": {
      const name = rest[0];
      if (!name) {
        console.error("usage: tarmac new <name> --owner team-x");
        return 1;
      }
      const ownerIndex = rest.indexOf("--owner");
      const owner = ownerIndex >= 0 ? rest[ownerIndex + 1] : undefined;
      if (!owner) {
        // Refusing rather than defaulting: a service whose owner is a
        // placeholder is a service nobody gets paged for.
        console.error("An owning team is required: tarmac new <name> --owner team-x");
        return 1;
      }

      const result = scaffold(resolve(process.cwd(), name), { name, owner });
      if (result.errors.length > 0) {
        console.error(`${red("Could not scaffold")} ${name}\n`);
        for (const error of result.errors) console.error(`  ${error}`);
        return 1;
      }

      console.log(`${green("Created")} ${name}\n`);
      for (const file of result.written) console.log(`  ${file}`);
      console.log(`\n${dim(`cd ${name} && tarmac validate`)}`);
      return 0;
    }

    case "validate": {
      const path = rest[0] ?? "service.yaml";
      const result = validateManifestFile(resolve(process.cwd(), path));
      if (result.valid) {
        console.log(`${green("valid")} ${path}`);
        console.log(dim(`  ${result.manifest.name} owned by ${result.manifest.owner}`));
        return 0;
      }
      console.error(`${red("invalid")} ${path}\n`);
      for (const error of result.errors) {
        console.error(`  ${error.path ? dim(`${error.path}: `) : ""}${error.message}`);
        if (error.hint) console.error(dim(`    -> ${error.hint}`));
      }
      return 1;
    }

    case "dev": {
      const resolution = currentService();
      if (!resolution.found) return 1;
      // Runs the service's own dev script, in the service's own directory. The
      // platform does not need to know how a service runs locally — that is the
      // one thing the team owns entirely.
      return run("npm", ["run", "dev"], dirname(resolution.service.manifestPath));
    }

    case "test":
      return run("npm", ["test", "--workspaces", "--if-present"]);

    case "deploy":
      return deploy(rest[0] ?? "dev");

    case "status":
      return status(rest[0] ?? "dev");

    case "logs":
      return run("make", ["logs"]);

    case "rollback":
      // Rollback is deploy-with-the-previous-image, which the deploy script
      // already knows how to do when a smoke test fails. Exposing it as its own
      // command means nobody has to remember that.
      {
        const resolution = currentService();
        if (!resolution.found) return 1;
        const environment = rest[0] ?? "dev";
        console.log(`${bold("Rolling back")} ${resolution.service.name} in ${environment}`);
        return run(join(REPO_ROOT, "platform", "scripts", "rollback.sh"), [
          environment,
          "local",
          resolution.service.manifestPath,
        ]);
      }

    default:
      console.error(`Unknown command: ${command}\n`);
      usage();
      return 1;
  }
}

process.exit(main(process.argv.slice(2)));
