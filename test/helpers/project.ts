import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FixturePackage {
  dev?: boolean;
  installed?: boolean;
  license?: unknown;
  name: string;
  optional?: boolean;
  version: string;
}

export async function createProject(packages: readonly FixturePackage[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "license-guard-test-"));
  const lockPackages: Record<string, object> = {
    "": {
      dependencies: Object.fromEntries(
        packages
          .filter((pkg) => pkg.dev !== true && pkg.optional !== true)
          .map((pkg) => [pkg.name, pkg.version]),
      ),
      devDependencies: Object.fromEntries(
        packages.filter((pkg) => pkg.dev === true).map((pkg) => [pkg.name, pkg.version]),
      ),
      name: "fixture-project",
      optionalDependencies: Object.fromEntries(
        packages
          .filter((pkg) => pkg.dev !== true && pkg.optional === true)
          .map((pkg) => [pkg.name, pkg.version]),
      ),
      version: "1.0.0",
    },
  };

  for (const pkg of packages) {
    const packagePath = `node_modules/${pkg.name}`;
    lockPackages[packagePath] = {
      ...(pkg.dev === undefined ? {} : { dev: pkg.dev }),
      ...(pkg.optional === undefined ? {} : { optional: pkg.optional }),
      version: pkg.version,
    };
    if (pkg.installed !== false) {
      await mkdir(join(root, packagePath), { recursive: true });
      await writeFile(
        join(root, packagePath, "package.json"),
        `${JSON.stringify({ name: pkg.name, version: pkg.version, license: pkg.license })}\n`,
      );
    }
  }

  await writeFile(
    join(root, "package-lock.json"),
    `${JSON.stringify({
      name: "fixture-project",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: lockPackages,
    })}\n`,
  );
  return root;
}

export async function removeProject(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}
