import type { ServiceManifest, ValidationError } from "./types.js";

/**
 * AWS Fargate only accepts specific CPU/memory pairs. JSON Schema can express
 * the valid set for each field independently but not the relationship between
 * them, so a manifest can pass schema validation and still be rejected by the
 * cloud at deploy time — the worst place to find out.
 */
const FARGATE_MEMORY_BY_CPU: ReadonlyMap<number, readonly number[]> = new Map([
  [256, [512, 1024, 2048]],
  [512, [1024, 2048, 3072, 4096]],
  [1024, [2048, 3072, 4096, 5120, 6144, 7168, 8192]],
  [2048, Array.from({ length: 13 }, (_, i) => 4096 + i * 1024)],
  [4096, Array.from({ length: 23 }, (_, i) => 8192 + i * 1024)],
]);

function checkFargateSizing(manifest: ServiceManifest): ValidationError[] {
  const cpu = manifest.runtime.cpu ?? 256;
  const memory = manifest.runtime.memory ?? 512;
  const allowed = FARGATE_MEMORY_BY_CPU.get(cpu);
  if (!allowed || allowed.includes(memory)) return [];
  return [
    {
      path: "runtime.memory",
      message: `memory ${memory} is not a valid pairing with cpu ${cpu}`,
      hint: `with cpu ${cpu}, memory must be one of: ${allowed.join(", ")}`,
    },
  ];
}

/**
 * Production deploys wait for a human. A team can opt into automatic deploys
 * for dev and staging, but not for prod — that is a platform decision, not an
 * application one, so it is enforced here rather than left to convention.
 */
function checkProdApproval(manifest: ServiceManifest): ValidationError[] {
  const prod = manifest.environments?.prod;
  if (!prod || prod.approval !== "automatic") return [];
  return [
    {
      path: "environments.prod.approval",
      message: "production deploys cannot be automatic",
      hint: 'remove the field or set it to "required"',
    },
  ];
}

/**
 * S3 rejects bucket names that contain consecutive dots or parse as an IP
 * address. Both are legal under the schema's character-class pattern.
 */
function checkBucketName(manifest: ServiceManifest): ValidationError[] {
  const name = manifest.resources?.bucket?.name;
  if (!name) return [];
  const errors: ValidationError[] = [];
  if (name.includes("..")) {
    errors.push({
      path: "resources.bucket.name",
      message: "bucket name cannot contain consecutive dots",
      hint: "use hyphens to separate words",
    });
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) {
    errors.push({
      path: "resources.bucket.name",
      message: "bucket name cannot be formatted as an IP address",
    });
  }
  return errors;
}

/**
 * Checks that JSON Schema cannot express: cross-field relationships and
 * platform policy. Run only after schema validation passes, so these can
 * assume the shape is already correct.
 */
export function checkSemantics(manifest: ServiceManifest): ValidationError[] {
  return [
    ...checkFargateSizing(manifest),
    ...checkProdApproval(manifest),
    ...checkBucketName(manifest),
  ];
}
