import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { validateManifestFile, type ServiceManifest } from "@tarmac/validate";

/**
 * Finding the service you are working on.
 *
 * Every command that acts on a service needs to know which one. The answer is
 * always the manifest — never a flag, never a name baked into the CLI. The
 * manifest is the contract; anything else is a second source of truth that will
 * eventually disagree with it.
 *
 * Searching upward from the working directory means the commands work from
 * anywhere inside a service, the way `git` does. Having to be in the repository
 * root to run `tarmac deploy` is the kind of small friction that makes people
 * write their own wrapper scripts, and then the road has a bypass.
 */
export interface ResolvedService {
  readonly name: string;
  readonly owner: string;
  readonly manifestPath: string;
  readonly manifest: ServiceManifest;
}

export type ServiceResolution =
  | { readonly found: true; readonly service: ResolvedService }
  | { readonly found: false; readonly reason: string; readonly hint: string };

export const MANIFEST_FILENAME = "service.yaml";

/**
 * Walks up from `startDir` looking for a manifest. Stops at the filesystem
 * root rather than recursing forever.
 *
 * @param exists injected so the search can be tested without a real tree.
 */
export function findManifestPath(
  startDir: string,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  let current = startDir;
  const { root } = parse(startDir);

  for (;;) {
    const candidate = join(current, MANIFEST_FILENAME);
    if (exists(candidate)) return candidate;
    if (current === root) return undefined;
    const parent = dirname(current);
    // Defensive: dirname of a malformed path can return the same value, which
    // would loop forever.
    if (parent === current) return undefined;
    current = parent;
  }
}

export function resolveService(
  startDir: string,
  exists: (path: string) => boolean = existsSync,
  validate: (path: string) => ReturnType<typeof validateManifestFile> = validateManifestFile,
): ServiceResolution {
  const manifestPath = findManifestPath(startDir, exists);

  if (!manifestPath) {
    return {
      found: false,
      reason: `no ${MANIFEST_FILENAME} found here or in any parent directory`,
      hint: "run this from inside a service, or create one with `tarmac new <name> --owner team-x`",
    };
  }

  const result = validate(manifestPath);
  if (!result.valid) {
    // Refusing to act on an invalid manifest rather than guessing. Deploying
    // from a manifest the platform cannot fully parse is how a service ends up
    // running with settings nobody chose.
    return {
      found: false,
      reason: `${manifestPath} is not valid`,
      hint: "run `tarmac validate` to see every problem at once",
    };
  }

  return {
    found: true,
    service: {
      name: result.manifest.name,
      owner: result.manifest.owner,
      manifestPath,
      manifest: result.manifest,
    },
  };
}

/**
 * The image reference for a service at a given commit.
 *
 * Derived from the service name so two services never collide, and so nothing
 * has to be configured per service. The registry prefix is the platform's to
 * decide, not the application team's.
 */
export function imageReference(serviceName: string, commit: string, registry = "tarmac"): string {
  return `${registry}/${serviceName}:${commit}`;
}
