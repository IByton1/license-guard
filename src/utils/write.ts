import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface WriteTextFileOptions {
  containmentRoot?: string;
  overwrite: boolean;
}

export async function writeTextFile(
  destination: string,
  content: string,
  options: WriteTextFileOptions,
): Promise<void> {
  const absoluteDestination = resolve(destination);
  const parent = dirname(absoluteDestination);
  const safeParent =
    options.containmentRoot === undefined
      ? await createParent(parent)
      : await createContainedParent(parent, options.containmentRoot);
  const safeDestination = join(safeParent, basename(absoluteDestination));

  if (!options.overwrite) {
    await writeFile(safeDestination, content, { encoding: "utf8", flag: "wx" });
    return;
  }

  try {
    if ((await lstat(safeDestination)).isSymbolicLink()) {
      throw new Error("the destination is a symbolic link");
    }
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }

  const temporary = join(safeParent, `.license-guard-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, safeDestination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function createParent(parent: string): Promise<string> {
  await mkdir(parent, { recursive: true });
  return parent;
}

async function createContainedParent(parent: string, containmentRoot: string): Promise<string> {
  const lexicalRoot = resolve(containmentRoot);
  const pathFromRoot = relative(lexicalRoot, parent);
  if (!isContainedPath(pathFromRoot)) {
    throw new Error("the destination resolves outside the project");
  }

  const root = await realpath(lexicalRoot);
  if (!(await lstat(root)).isDirectory()) {
    throw new Error("the containment root is not a directory");
  }

  let current = root;
  for (const segment of pathFromRoot.split(sep).filter((value) => value.length > 0)) {
    const candidate = join(current, segment);
    try {
      await mkdir(candidate);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }

    const resolvedCandidate = await realpath(candidate);
    if (!isContainedPath(relative(root, resolvedCandidate))) {
      throw new Error("the destination resolves outside the project");
    }
    if (!(await lstat(resolvedCandidate)).isDirectory()) {
      throw new Error("the destination parent is not a directory");
    }
    current = resolvedCandidate;
  }

  return current;
}

function isContainedPath(pathFromRoot: string): boolean {
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
}

function isFileNotFound(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isAlreadyExists(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}
