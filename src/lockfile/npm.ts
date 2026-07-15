import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { errorMessage, LicenseGuardError } from "../errors.js";
import { compareText } from "../utils/sort.js";
import type { LockfileResult, PackageReference } from "./types.js";

export interface ParseNpmLockfileOptions {
  production?: boolean;
}

const MAX_LOCKFILE_SIZE = 64 * 1024 * 1024;

type JsonObject = Record<string, unknown>;

interface DependencyEdge {
  from: string;
  name: string;
  optional: boolean;
}

type PackageReachability = "optional" | "required";

interface DependencyTraversal extends DependencyEdge {
  reachability: PackageReachability;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidLockfile(lockfilePath: string, detail: string, cause?: unknown): LicenseGuardError {
  return new LicenseGuardError(
    "LOCKFILE_INVALID",
    `Invalid package-lock.json at "${lockfilePath}": ${detail}`,
    cause,
  );
}

function unsupportedLockfile(lockfilePath: string, detail: string): LicenseGuardError {
  return new LicenseGuardError(
    "LOCKFILE_UNSUPPORTED",
    `Unsupported package-lock.json at "${lockfilePath}": ${detail}`,
  );
}

function hasOwn(object: JsonObject, property: string): boolean {
  return Object.hasOwn(object, property);
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }
  return false;
}

function hasUnsafeNameCharacter(value: string): boolean {
  for (const character of value) {
    if (
      character.trim().length === 0 ||
      '<>:@"|?*\\'.includes(character) ||
      hasControlCharacter(character)
    ) {
      return true;
    }
  }
  return false;
}

function readBoolean(
  entry: JsonObject,
  property: "dev" | "optional",
  packagePath: string,
  lockfilePath: string,
): boolean {
  const value = entry[property];
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw invalidLockfile(
      lockfilePath,
      `package entry "${packagePath}" has a non-boolean ${property} field.`,
    );
  }
  return value;
}

function validatePackageName(name: string, packagePath: string, lockfilePath: string): string {
  const parts = name.split("/");
  const scoped = name.startsWith("@");
  const valid = scoped
    ? parts.length === 2 && parts[0]?.length !== 1 && parts[1]?.length !== 0
    : parts.length === 1 && parts[0]?.length !== 0;
  const invalidPart = parts.some((part) => {
    const unscopedPart = part.startsWith("@") ? part.slice(1) : part;
    return (
      unscopedPart.startsWith(".") ||
      hasUnsafeNameCharacter(unscopedPart) ||
      part === "." ||
      part === ".." ||
      part === "node_modules"
    );
  });

  if (!valid || invalidPart || name.length > 214) {
    throw invalidLockfile(
      lockfilePath,
      `package entry "${packagePath}" has an invalid package name "${name}".`,
    );
  }

  return name;
}

function validateRelativePath(packagePath: string, lockfilePath: string): readonly string[] {
  if (
    packagePath.startsWith("/") ||
    /^[A-Za-z]:($|\/)/u.test(packagePath) ||
    packagePath.includes("\\") ||
    hasControlCharacter(packagePath)
  ) {
    throw invalidLockfile(lockfilePath, `package entry path "${packagePath}" is unsafe.`);
  }

  const segments = packagePath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw invalidLockfile(lockfilePath, `package entry path "${packagePath}" is unsafe.`);
  }

  return segments;
}

function packageNameFromPath(packagePath: string, lockfilePath: string): string {
  const segments = validateRelativePath(packagePath, lockfilePath);

  if (segments[0] !== "node_modules") {
    throw unsupportedLockfile(
      lockfilePath,
      `npm workspaces and local package entries are not supported yet (entry "${packagePath}").`,
    );
  }

  let index = 0;
  let packageName = "";
  while (index < segments.length) {
    if (segments[index] !== "node_modules") {
      throw invalidLockfile(lockfilePath, `package entry path "${packagePath}" is malformed.`);
    }

    const firstNamePart = segments[index + 1];
    if (firstNamePart === undefined || firstNamePart === "node_modules") {
      throw invalidLockfile(lockfilePath, `package entry path "${packagePath}" is malformed.`);
    }

    if (firstNamePart.startsWith("@")) {
      const secondNamePart = segments[index + 2];
      if (
        firstNamePart.length === 1 ||
        secondNamePart === undefined ||
        secondNamePart.startsWith("@") ||
        secondNamePart === "node_modules"
      ) {
        throw invalidLockfile(lockfilePath, `package entry path "${packagePath}" is malformed.`);
      }
      packageName = validatePackageName(
        `${firstNamePart}/${secondNamePart}`,
        packagePath,
        lockfilePath,
      );
      index += 3;
    } else {
      packageName = validatePackageName(firstNamePart, packagePath, lockfilePath);
      index += 2;
    }
  }

  return packageName;
}

function parsePackageEntry(
  entry: unknown,
  packagePath: string,
  lockfilePath: string,
): PackageReference {
  if (!isJsonObject(entry)) {
    throw invalidLockfile(lockfilePath, `package entry "${packagePath}" must be an object.`);
  }

  if (hasOwn(entry, "link")) {
    if (typeof entry.link !== "boolean") {
      throw invalidLockfile(
        lockfilePath,
        `package entry "${packagePath}" has a non-boolean link field.`,
      );
    }
    if (entry.link) {
      throw unsupportedLockfile(
        lockfilePath,
        `linked packages and npm workspaces are not supported yet (entry "${packagePath}").`,
      );
    }
  }

  const derivedName = packageNameFromPath(packagePath, lockfilePath);
  let name = derivedName;
  if (hasOwn(entry, "name")) {
    if (typeof entry.name !== "string") {
      throw invalidLockfile(
        lockfilePath,
        `package entry "${packagePath}" has a non-string name field.`,
      );
    }
    name = validatePackageName(entry.name, packagePath, lockfilePath);
  }

  if (
    typeof entry.version !== "string" ||
    entry.version.trim().length === 0 ||
    entry.version !== entry.version.trim() ||
    entry.version.length > 256 ||
    hasControlCharacter(entry.version)
  ) {
    throw invalidLockfile(
      lockfilePath,
      `package entry "${packagePath}" has no valid version field.`,
    );
  }

  return {
    dev: readBoolean(entry, "dev", packagePath, lockfilePath),
    name,
    optional: readBoolean(entry, "optional", packagePath, lockfilePath),
    path: packagePath,
    version: entry.version,
  };
}

function comparePackages(left: PackageReference, right: PackageReference): number {
  return (
    compareText(left.name, right.name) ||
    compareText(left.version, right.version) ||
    compareText(left.path, right.path)
  );
}

function readDependencyMap(
  entry: JsonObject,
  property: "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies",
  packagePath: string,
  lockfilePath: string,
): readonly string[] {
  const value = entry[property];
  if (value === undefined) return [];
  if (!isJsonObject(value)) {
    throw invalidLockfile(
      lockfilePath,
      `package entry "${packagePath || "<root>"}" has a non-object ${property} field.`,
    );
  }

  return Object.entries(value).map(([name, range]) => {
    validatePackageName(name, packagePath || "<root>", lockfilePath);
    if (
      typeof range !== "string" ||
      range.trim().length === 0 ||
      range !== range.trim() ||
      hasControlCharacter(range)
    ) {
      throw invalidLockfile(
        lockfilePath,
        `package entry "${packagePath || "<root>"}" has an invalid ${property} range for "${name}".`,
      );
    }
    return name;
  });
}

function dependencyEdges(
  entry: JsonObject,
  packagePath: string,
  lockfilePath: string,
): readonly DependencyEdge[] {
  const optional = new Set(
    readDependencyMap(entry, "optionalDependencies", packagePath, lockfilePath),
  );
  const edges = new Map<string, DependencyEdge>();
  for (const name of readDependencyMap(entry, "dependencies", packagePath, lockfilePath)) {
    edges.set(name, { from: packagePath, name, optional: optional.has(name) });
  }
  for (const name of optional) {
    edges.set(name, { from: packagePath, name, optional: true });
  }
  const optionalPeers = readOptionalPeerDependencies(entry, packagePath, lockfilePath);
  for (const name of readDependencyMap(entry, "peerDependencies", packagePath, lockfilePath)) {
    if (!edges.has(name)) {
      edges.set(name, { from: packagePath, name, optional: optionalPeers.has(name) });
    }
  }
  return [...edges.values()];
}

function readOptionalPeerDependencies(
  entry: JsonObject,
  packagePath: string,
  lockfilePath: string,
): ReadonlySet<string> {
  const value = entry.peerDependenciesMeta;
  if (value === undefined) return new Set();
  if (!isJsonObject(value)) {
    throw invalidLockfile(
      lockfilePath,
      `package entry "${packagePath || "<root>"}" has non-object peerDependenciesMeta.`,
    );
  }

  const peers = new Set(readDependencyMap(entry, "peerDependencies", packagePath, lockfilePath));
  const optional = new Set<string>();
  for (const [name, metadata] of Object.entries(value)) {
    validatePackageName(name, packagePath || "<root>", lockfilePath);
    if (
      !isJsonObject(metadata) ||
      (metadata.optional !== undefined && typeof metadata.optional !== "boolean")
    ) {
      throw invalidLockfile(
        lockfilePath,
        `package entry "${packagePath || "<root>"}" has invalid peerDependenciesMeta for "${name}".`,
      );
    }
    if (peers.has(name) && metadata.optional === true) optional.add(name);
  }
  return optional;
}

function parentPackagePath(packagePath: string): string {
  const segments = packagePath.split("/");
  const lastNodeModules = segments.lastIndexOf("node_modules");
  return lastNodeModules === -1 ? "" : segments.slice(0, lastNodeModules).join("/");
}

function resolveDependencyPath(
  packagePath: string,
  dependencyName: string,
  entries: ReadonlyMap<string, JsonObject>,
): string | null {
  let current = packagePath;
  while (true) {
    const candidate = current
      ? `${current}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;
    if (entries.has(candidate)) return candidate;
    if (current === "") return null;
    current = parentPackagePath(current);
  }
}

function collectReachablePackages(
  initialEdges: readonly DependencyEdge[],
  entries: ReadonlyMap<string, JsonObject>,
  lockfilePath: string,
): ReadonlyMap<string, PackageReachability> {
  const reachable = new Map<string, PackageReachability>();
  const queue: DependencyTraversal[] = initialEdges.map((edge) => ({
    ...edge,
    reachability: edge.optional ? "optional" : "required",
  }));
  let cursor = 0;

  while (cursor < queue.length) {
    const edge = queue[cursor];
    cursor += 1;
    if (edge === undefined) continue;
    const resolvedPath = resolveDependencyPath(edge.from, edge.name, entries);
    if (resolvedPath === null) {
      if (edge.reachability === "optional") continue;
      throw invalidLockfile(
        lockfilePath,
        `dependency "${edge.name}" declared by "${edge.from || "<root>"}" has no package entry.`,
      );
    }
    const previousReachability = reachable.get(resolvedPath);
    if (previousReachability === "required" || previousReachability === edge.reachability) {
      continue;
    }
    reachable.set(resolvedPath, edge.reachability);
    const entry = entries.get(resolvedPath);
    if (entry === undefined) continue;
    for (const dependency of dependencyEdges(entry, resolvedPath, lockfilePath)) {
      queue.push({
        ...dependency,
        reachability:
          edge.reachability === "optional" || dependency.optional ? "optional" : "required",
      });
    }
  }

  return reachable;
}

function mergePackageReachability(
  packagePath: string,
  productionReachable: ReadonlyMap<string, PackageReachability>,
  developmentReachable: ReadonlyMap<string, PackageReachability>,
  includeDevelopment: boolean,
): PackageReachability | undefined {
  const production = productionReachable.get(packagePath);
  const development = includeDevelopment ? developmentReachable.get(packagePath) : undefined;
  if (production === "required" || development === "required") return "required";
  return production ?? development;
}

export async function parseNpmLockfile(
  projectPath: string,
  options: ParseNpmLockfileOptions = {},
): Promise<LockfileResult> {
  const resolvedProjectPath = resolve(projectPath);
  const lockfilePath = resolve(resolvedProjectPath, "package-lock.json");

  let source: string;
  try {
    const [projectDirectory, resolvedLockfilePath] = await Promise.all([
      realpath(resolvedProjectPath),
      realpath(lockfilePath),
    ]);
    const pathFromProject = relative(projectDirectory, resolvedLockfilePath);
    if (
      pathFromProject === ".." ||
      pathFromProject.startsWith(`..${sep}`) ||
      isAbsolute(pathFromProject)
    ) {
      throw invalidLockfile(lockfilePath, "the file resolves outside the project.");
    }
    const metadata = await stat(resolvedLockfilePath);
    if (!metadata.isFile()) {
      throw invalidLockfile(lockfilePath, "the path is not a regular file.");
    }
    if (metadata.size > MAX_LOCKFILE_SIZE) {
      throw invalidLockfile(
        lockfilePath,
        `the file exceeds the ${MAX_LOCKFILE_SIZE / (1024 * 1024)} MiB size limit.`,
      );
    }
    source = await readFile(resolvedLockfilePath, "utf8");
  } catch (error) {
    if (error instanceof LicenseGuardError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new LicenseGuardError(
        "LOCKFILE_NOT_FOUND",
        `No package-lock.json found at "${lockfilePath}". Run npm install with npm 7 or newer.`,
        error,
      );
    }
    throw invalidLockfile(
      lockfilePath,
      `the file could not be read: ${errorMessage(error)}.`,
      error,
    );
  }

  let lockfile: unknown;
  try {
    lockfile = JSON.parse(source);
  } catch (error) {
    throw invalidLockfile(lockfilePath, "the file is not valid JSON.", error);
  }

  if (!isJsonObject(lockfile)) {
    throw invalidLockfile(lockfilePath, "the document root must be an object.");
  }

  const { lockfileVersion } = lockfile;
  if (typeof lockfileVersion !== "number" || !Number.isInteger(lockfileVersion)) {
    throw invalidLockfile(lockfilePath, "lockfileVersion must be an integer.");
  }
  if (lockfileVersion !== 2 && lockfileVersion !== 3) {
    const guidance =
      lockfileVersion === 1
        ? "Version 1 is not supported. Regenerate the lockfile with npm 7 or newer."
        : `Version ${lockfileVersion} is not supported; expected version 2 or 3.`;
    throw unsupportedLockfile(lockfilePath, guidance);
  }

  if (!isJsonObject(lockfile.packages)) {
    throw invalidLockfile(lockfilePath, 'the required "packages" object is missing.');
  }
  const rootEntry = lockfile.packages[""];
  if (!isJsonObject(rootEntry)) {
    throw invalidLockfile(lockfilePath, 'the required root package entry "" is missing.');
  }

  const packages: PackageReference[] = [];
  const packageEntries = new Map<string, JsonObject>();
  for (const [packagePath, entry] of Object.entries(lockfile.packages)) {
    if (packagePath === "") {
      continue;
    }

    const packageReference = parsePackageEntry(entry, packagePath, lockfilePath);
    packages.push(packageReference);
    packageEntries.set(packagePath, entry as JsonObject);
  }

  const productionReachable = collectReachablePackages(
    dependencyEdges(rootEntry, "", lockfilePath),
    packageEntries,
    lockfilePath,
  );
  const developmentReachable = collectReachablePackages(
    readDependencyMap(rootEntry, "devDependencies", "", lockfilePath).map((name) => ({
      from: "",
      name,
      optional: false,
    })),
    packageEntries,
    lockfilePath,
  );
  const selectedPackages = (
    options.production
      ? packages.filter(
          (pkg) => !developmentReachable.has(pkg.path) || productionReachable.has(pkg.path),
        )
      : packages
  ).map((pkg) => {
    const reachability = mergePackageReachability(
      pkg.path,
      productionReachable,
      developmentReachable,
      !options.production,
    );
    const dev = productionReachable.has(pkg.path)
      ? false
      : developmentReachable.has(pkg.path)
        ? true
        : pkg.dev;
    if (reachability === undefined && dev === pkg.dev) return pkg;
    return {
      ...pkg,
      dev,
      optional: reachability === undefined ? pkg.optional : reachability === "optional",
    };
  });
  selectedPackages.sort(comparePackages);

  return {
    lockfilePath,
    lockfileVersion,
    packages: selectedPackages,
  };
}
