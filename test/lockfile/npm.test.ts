import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { LicenseGuardError, type LicenseGuardErrorCode } from "../../src/errors.js";
import { parseNpmLockfile } from "../../src/lockfile/npm.js";

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const temporaryDirectories: string[] = [];

async function createProject(lockfile: unknown | string): Promise<string> {
  const projectPath = await mkdtemp(join(tmpdir(), "license-guard-npm-"));
  temporaryDirectories.push(projectPath);
  await writeFile(
    join(projectPath, "package-lock.json"),
    typeof lockfile === "string" ? lockfile : JSON.stringify(lockfile),
  );
  return projectPath;
}

async function expectLicenseGuardError(
  operation: Promise<unknown>,
  code: LicenseGuardErrorCode,
): Promise<LicenseGuardError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(LicenseGuardError);
    expect(error).toMatchObject({ code, name: "LicenseGuardError" });
    return error as LicenseGuardError;
  }
  throw new Error(`Expected ${code}`);
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("parseNpmLockfile", () => {
  it("normalizes npm v2 package entries and sorts them deterministically", async () => {
    const projectPath = join(fixtureRoot, "npm-v2");

    const result = await parseNpmLockfile(projectPath);

    expect(result).toEqual({
      lockfilePath: join(projectPath, "package-lock.json"),
      lockfileVersion: 2,
      packages: [
        {
          dev: false,
          name: "@nested/child",
          optional: false,
          path: "node_modules/parent/node_modules/@nested/child",
          version: "4.1.0",
        },
        {
          dev: true,
          name: "@scope/dev-only",
          optional: false,
          path: "node_modules/@scope/dev-only",
          version: "3.0.0",
        },
        {
          dev: false,
          name: "actual-package",
          optional: false,
          path: "node_modules/alias-name",
          version: "2.0.0",
        },
        {
          dev: false,
          name: "parent",
          optional: false,
          path: "node_modules/parent",
          version: "1.0.0",
        },
        {
          dev: false,
          name: "zeta",
          optional: true,
          path: "node_modules/zeta",
          version: "5.0.0",
        },
      ],
    });
  });

  it("supports npm v3 and excludes dev-only entries in production mode", async () => {
    const result = await parseNpmLockfile(join(fixtureRoot, "npm-v3"), { production: true });

    expect(result.lockfileVersion).toBe(3);
    expect(result.packages).toEqual([
      {
        dev: false,
        name: "beta",
        optional: false,
        path: "node_modules/beta",
        version: "2.0.0",
      },
      {
        dev: false,
        name: "child",
        optional: true,
        path: "node_modules/alpha/node_modules/child",
        version: "3.0.0",
      },
    ]);
  });

  it("reports a missing lockfile", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "license-guard-npm-missing-"));
    temporaryDirectories.push(projectPath);

    const error = await expectLicenseGuardError(
      parseNpmLockfile(projectPath),
      "LOCKFILE_NOT_FOUND",
    );

    expect(error.message).toContain("npm install");
  });

  it("rejects invalid JSON", async () => {
    const projectPath = await createProject("{not-json");

    await expectLicenseGuardError(parseNpmLockfile(projectPath), "LOCKFILE_INVALID");
  });

  it("rejects lockfiles above the input size limit", async () => {
    const projectPath = await createProject({ lockfileVersion: 3, packages: { "": {} } });
    await truncate(join(projectPath, "package-lock.json"), 64 * 1024 * 1024 + 1);

    const error = await expectLicenseGuardError(parseNpmLockfile(projectPath), "LOCKFILE_INVALID");
    expect(error.message).toContain("64 MiB size limit");
  });

  it("rejects lockfile v1 with upgrade guidance", async () => {
    const projectPath = await createProject({ dependencies: {}, lockfileVersion: 1 });

    const error = await expectLicenseGuardError(
      parseNpmLockfile(projectPath),
      "LOCKFILE_UNSUPPORTED",
    );

    expect(error.message).toContain("npm 7 or newer");
  });

  it("rejects v2 and v3 documents without a packages object", async () => {
    const projectPath = await createProject({ lockfileVersion: 3 });

    await expectLicenseGuardError(parseNpmLockfile(projectPath), "LOCKFILE_INVALID");
  });

  it("rejects a packages map without its root entry", async () => {
    const projectPath = await createProject({ lockfileVersion: 3, packages: {} });

    await expectLicenseGuardError(parseNpmLockfile(projectPath), "LOCKFILE_INVALID");
  });

  it("rejects a root dependency without a package entry", async () => {
    const projectPath = await createProject({
      lockfileVersion: 3,
      packages: { "": { dependencies: { missing: "1.0.0" } } },
    });

    const error = await expectLicenseGuardError(parseNpmLockfile(projectPath), "LOCKFILE_INVALID");
    expect(error.message).toContain('dependency "missing"');
  });

  it("does not hide a production dependency with a forged dev marker", async () => {
    const projectPath = await createProject({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { runtime: "1.0.0" } },
        "node_modules/runtime": { dev: true, version: "1.0.0" },
      },
    });

    const result = await parseNpmLockfile(projectPath, { production: true });

    expect(result.packages).toEqual([
      expect.objectContaining({ dev: false, name: "runtime", path: "node_modules/runtime" }),
    ]);
  });

  it("derives optionality from direct and transitive dependency reachability", async () => {
    const projectPath = await createProject({
      lockfileVersion: 3,
      packages: {
        "": {
          dependencies: { "required-parent": "1.0.0" },
          optionalDependencies: { "optional-parent": "1.0.0" },
        },
        "node_modules/optional-child": { optional: false, version: "1.0.0" },
        "node_modules/optional-parent": {
          dependencies: { "optional-child": "1.0.0", shared: "1.0.0" },
          optional: false,
          version: "1.0.0",
        },
        "node_modules/required-parent": {
          dependencies: { "required-intermediate": "1.0.0" },
          optional: true,
          version: "1.0.0",
        },
        "node_modules/required-intermediate": {
          dependencies: { shared: "1.0.0" },
          optional: true,
          version: "1.0.0",
        },
        "node_modules/shared": {
          dependencies: { "shared-child": "1.0.0" },
          optional: true,
          version: "1.0.0",
        },
        "node_modules/shared-child": { optional: true, version: "1.0.0" },
      },
    });

    const result = await parseNpmLockfile(projectPath);

    expect(result.packages).toEqual([
      expect.objectContaining({ name: "optional-child", optional: true }),
      expect.objectContaining({ name: "optional-parent", optional: true }),
      expect.objectContaining({ name: "required-intermediate", optional: false }),
      expect.objectContaining({ name: "required-parent", optional: false }),
      expect.objectContaining({ name: "shared", optional: false }),
      expect.objectContaining({ name: "shared-child", optional: false }),
    ]);
  });

  it("treats peers as required unless peerDependenciesMeta marks them optional", async () => {
    const projectPath = await createProject({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { parent: "1.0.0" } },
        "node_modules/optional-peer": { optional: false, version: "1.0.0" },
        "node_modules/parent": {
          peerDependencies: {
            "optional-peer": "1.0.0",
            "required-peer": "1.0.0",
          },
          peerDependenciesMeta: {
            "optional-peer": { optional: true },
          },
          version: "1.0.0",
        },
        "node_modules/required-peer": { optional: true, version: "1.0.0" },
      },
    });

    const result = await parseNpmLockfile(projectPath);

    expect(result.packages).toEqual([
      expect.objectContaining({ name: "optional-peer", optional: true }),
      expect.objectContaining({ name: "parent", optional: false }),
      expect.objectContaining({ name: "required-peer", optional: false }),
    ]);
  });

  it("rejects invalid optional peer metadata", async () => {
    const projectPath = await createProject({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { parent: "1.0.0" } },
        "node_modules/parent": {
          peerDependencies: { peer: "1.0.0" },
          peerDependenciesMeta: { peer: { optional: "yes" } },
          version: "1.0.0",
        },
        "node_modules/peer": { version: "1.0.0" },
      },
    });

    await expectLicenseGuardError(parseNpmLockfile(projectPath), "LOCKFILE_INVALID");
  });

  it("accepts peer metadata retained without a corresponding peer entry", async () => {
    const projectPath = await createProject({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { parent: "1.0.0" } },
        "node_modules/parent": {
          peerDependenciesMeta: { peer: { optional: true } },
          version: "1.0.0",
        },
      },
    });

    const result = await parseNpmLockfile(projectPath);

    expect(result.packages).toEqual([expect.objectContaining({ name: "parent" })]);
  });

  it.each([
    ["a linked package", "node_modules/workspace", { link: true, resolved: "packages/a" }],
    ["a workspace package", "packages/a", { name: "a", version: "1.0.0" }],
  ])("rejects %s", async (_label, packagePath, entry) => {
    const projectPath = await createProject({
      lockfileVersion: 3,
      packages: { "": {}, [packagePath]: entry },
    });

    await expectLicenseGuardError(parseNpmLockfile(projectPath), "LOCKFILE_UNSUPPORTED");
  });

  it.each([
    "../node_modules/escape",
    "/node_modules/escape",
    "C:/node_modules/escape",
    "node_modules\\escape",
    "node_modules/foo/../escape",
    "node_modules/foo//node_modules/bar",
    "node_modules/foo/child",
    "node_modules/.bin",
    "node_modules/invalid:name",
    "node_modules/invalid:name/node_modules/child",
    "node_modules/@scope",
    "node_modules/foo/node_modules",
  ])("rejects unsafe or malformed package path %s", async (packagePath) => {
    const projectPath = await createProject({
      lockfileVersion: 3,
      packages: { "": {}, [packagePath]: { version: "1.0.0" } },
    });

    await expectLicenseGuardError(parseNpmLockfile(projectPath), "LOCKFILE_INVALID");
  });

  it.each([
    ["entry", null],
    ["version", { version: "" }],
    ["name", { name: "../escape", version: "1.0.0" }],
    ["dev", { dev: "true", version: "1.0.0" }],
    ["optional", { optional: 1, version: "1.0.0" }],
    ["link", { link: "true", version: "1.0.0" }],
  ])("rejects a malformed %s field", async (_label, entry) => {
    const projectPath = await createProject({
      lockfileVersion: 3,
      packages: { "": {}, "node_modules/package": entry },
    });

    await expectLicenseGuardError(parseNpmLockfile(projectPath), "LOCKFILE_INVALID");
  });

  it("validates dev entries before production filtering", async () => {
    const projectPath = await createProject({
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/dev-package": { dev: true, link: true },
      },
    });

    await expectLicenseGuardError(
      parseNpmLockfile(projectPath, { production: true }),
      "LOCKFILE_UNSUPPORTED",
    );
  });
});
