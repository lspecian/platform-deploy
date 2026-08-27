import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { checkSemantics } from "./semantic.js";
import type { ServiceManifest, ValidationError, ValidationResult } from "./types.js";

export type { ServiceManifest, ValidationError, ValidationResult } from "./types.js";

export const SCHEMA_PATH = fileURLToPath(
  new URL("../../schema/service.schema.json", import.meta.url),
);

function loadSchema(): object {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as object;
}

const ajv = new Ajv2020({
  // Report everything wrong at once. Fixing a manifest one error per run is a
  // miserable loop, and the whole point of this contract is that it is pleasant.
  allErrors: true,
  strict: true,
  useDefaults: false,
});
addFormats.default(ajv);
const validateSchema = ajv.compile(loadSchema());

/** Turns Ajv's terse output into something a developer can act on. */
function toValidationError(error: ErrorObject): ValidationError {
  const path = error.instancePath.replace(/^\//, "").replace(/\//g, ".");

  if (error.keyword === "additionalProperties") {
    const offending = (error.params as { additionalProperty: string }).additionalProperty;
    return {
      path: path ? `${path}.${offending}` : offending,
      message: `unknown field "${offending}"`,
      // Unknown fields are rejected rather than ignored. A typo'd field that is
      // silently dropped looks like it worked and does nothing — the failure
      // mode where someone sets a memory limit and wonders why nothing changed.
      hint: "check the spelling, or remove it if it is not part of the contract",
    };
  }

  if (error.keyword === "required") {
    const missing = (error.params as { missingProperty: string }).missingProperty;
    return {
      path: path ? `${path}.${missing}` : missing,
      message: `missing required field "${missing}"`,
    };
  }

  if (error.keyword === "pattern") {
    return {
      path,
      message: `"${path}" does not match the required format`,
      hint: `must match ${(error.params as { pattern: string }).pattern}`,
    };
  }

  if (error.keyword === "enum" || error.keyword === "const") {
    const allowed = (error.params as { allowedValues?: unknown[] }).allowedValues;
    return {
      path,
      message: `"${path}" has an unsupported value`,
      ...(allowed ? { hint: `allowed values: ${allowed.join(", ")}` } : {}),
    };
  }

  return { path, message: `${path || "manifest"} ${error.message ?? "is invalid"}` };
}

/**
 * Validates a service manifest.
 *
 * This is the single implementation. The CLI, the pre-commit hook and CI all
 * call it, so local and CI can never disagree about whether a manifest is
 * valid — a divergence there destroys trust in the whole road.
 */
export function validateManifest(input: string | unknown): ValidationResult {
  let document: unknown;

  if (typeof input === "string") {
    try {
      document = parseYaml(input);
    } catch (error) {
      if (error instanceof YAMLParseError) {
        const line = error.linePos?.[0]?.line;
        return {
          valid: false,
          errors: [
            {
              path: "",
              message: `manifest is not valid YAML: ${error.message.split("\n")[0]}`,
              ...(line ? { hint: `check line ${line}` } : {}),
            },
          ],
        };
      }
      /* v8 ignore next 2 -- the yaml parser only throws YAMLParseError for
         string input; this rethrow exists so a future parser change surfaces
         loudly instead of being swallowed. Unreachable through the public API. */
      throw error;
    }
  } else {
    document = input;
  }

  if (document === null || document === undefined) {
    return { valid: false, errors: [{ path: "", message: "manifest is empty" }] };
  }

  if (typeof document !== "object" || Array.isArray(document)) {
    return {
      valid: false,
      errors: [{ path: "", message: "manifest must be a YAML mapping at the top level" }],
    };
  }

  if (!validateSchema(document)) {
    const errors = (validateSchema.errors ?? []).map(toValidationError);
    return { valid: false, errors };
  }

  const manifest = document as ServiceManifest;
  const semanticErrors = checkSemantics(manifest);
  if (semanticErrors.length > 0) return { valid: false, errors: semanticErrors };

  return { valid: true, manifest, errors: [] };
}

/** Convenience wrapper for the common case of validating a file on disk. */
export function validateManifestFile(path: string): ValidationResult {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return {
      valid: false,
      errors: [
        {
          path: "",
          message: `cannot read manifest at ${path}`,
          hint: "every service needs a service.yaml at its root — run `tarmac new` to scaffold one",
        },
      ],
    };
  }
  return validateManifest(contents);
}
