import type { Dirent } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { PackageReference, PackageWarning, ResolvedPackage } from "../lockfile/types.js";
import { detectLicenseEvidenceFromText } from "./heuristics.js";
import {
  formatSpdxExpression,
  normalizeSpdx,
  parseSpdxExpression,
  type SpdxExpression,
} from "./spdx.js";

const MAX_LICENSE_FILE_SIZE = 512 * 1024;
const MAX_MANIFEST_FILE_SIZE = 1024 * 1024;

interface ManifestDeclaration {
  conflict: boolean;
  invalid: boolean;
  raw: string | null;
}

interface LegacyDeclaration {
  invalid: boolean;
  raw: string | null;
}

interface FileDetection {
  ambiguous: boolean;
  license: string | null;
  strictExpression: boolean;
}

export async function extractPackageLicense(
  projectPath: string,
  reference: PackageReference,
): Promise<ResolvedPackage> {
  const warnings: PackageWarning[] = [];
  const packagePath = resolvePackagePath(projectPath, reference.path);
  if (packagePath === null || !(await isDirectory(packagePath))) {
    warnings.push({
      code: "PACKAGE_MISSING",
      message: reference.optional
        ? `Optional package ${packageLabel(reference)} is not installed at ${reference.path || "."} and was skipped.`
        : `${packageLabel(reference)} is missing at ${reference.path || "."}. Run npm install before checking licenses.`,
    });
    return createResolvedPackage(reference, null, null, warnings);
  }
  if (!(await isPathContained(projectPath, packagePath))) {
    warnings.push({
      code: "PACKAGE_OUTSIDE_PROJECT",
      message: `${packageLabel(reference)} resolves outside the project and was not inspected.`,
    });
    return createResolvedPackage(reference, null, null, warnings);
  }

  const manifest = await readManifest(packagePath, reference, warnings);
  const manifestUnavailable = manifest === null;
  const manifestMismatch = manifest !== null && !manifestMatchesReference(manifest, reference);
  if (manifestMismatch) {
    warnings.push({
      code: "MANIFEST_MISMATCH",
      message: `${packageLabel(reference)} does not match the name and version in its installed package.json.`,
    });
  }
  const declaration =
    manifest === null ? { conflict: false, invalid: false, raw: null } : readDeclaration(manifest);
  const declaredLicense = declaration.raw === null ? null : normalizeSpdx(declaration.raw);
  if (declaration.invalid || (declaration.raw !== null && declaredLicense === null)) {
    warnings.push({
      code: "DECLARED_LICENSE_INVALID",
      message: `${packageLabel(reference)} has one or more invalid license declarations.`,
    });
  }
  if (declaration.conflict) {
    warnings.push({
      code: "DECLARED_LICENSE_CONFLICT",
      message: `${packageLabel(reference)} has conflicting license and licenses declarations; both are evaluated conservatively.`,
    });
  }

  const detection = await detectLicenseFile(packagePath);
  const detectedLicense = detection.license;
  if (detection.ambiguous) {
    warnings.push({
      code: "LICENSE_EVIDENCE_AMBIGUOUS",
      message: `${packageLabel(reference)} has license files that could not be classified consistently.`,
    });
  }
  const supplementalDetectedLicenses =
    declaredLicense === null || detectedLicense === null
      ? []
      : findSupplementalDetectedLicenses(
          declaredLicense,
          detectedLicense,
          detection.strictExpression,
        );
  const mismatch = supplementalDetectedLicenses.length > 0;
  if (mismatch) {
    warnings.push({
      code: "LICENSE_MISMATCH",
      message: `${packageLabel(reference)} declares ${declaredLicense}, but its license file matches ${detectedLicense}; both are evaluated conservatively.`,
    });
  }

  return createResolvedPackage(
    reference,
    declaredLicense,
    detectedLicense,
    warnings,
    supplementalDetectedLicenses,
    manifestUnavailable || manifestMismatch,
  );
}

function createResolvedPackage(
  reference: PackageReference,
  declaredLicense: string | null,
  detectedLicense: string | null,
  warnings: readonly PackageWarning[],
  supplementalDetectedLicenses: readonly string[] = [],
  manifestUntrusted = false,
): ResolvedPackage {
  const combinedLicense =
    supplementalDetectedLicenses.length > 0 && declaredLicense !== null
      ? normalizeSpdx(
          `(${declaredLicense}) AND ${supplementalDetectedLicenses
            .map((license) => `(${license})`)
            .join(" AND ")}`,
        )
      : null;
  const combinationFailed = supplementalDetectedLicenses.length > 0 && combinedLicense === null;
  const finalLicense = manifestUntrusted
    ? "UNKNOWN"
    : combinationFailed
      ? "UNKNOWN"
      : (combinedLicense ?? declaredLicense ?? detectedLicense ?? "UNKNOWN");
  const licenseSource = manifestUntrusted
    ? "unknown"
    : combinationFailed
      ? "unknown"
      : combinedLicense !== null
        ? "combined"
        : declaredLicense !== null
          ? "declared"
          : detectedLicense !== null
            ? "detected"
            : "unknown";
  return {
    ...reference,
    declaredLicense,
    detectedLicense,
    finalLicense,
    licenseSource,
    warnings,
  };
}

async function readManifest(
  packagePath: string,
  reference: PackageReference,
  warnings: PackageWarning[],
): Promise<Record<string, unknown> | null> {
  let source: string;
  try {
    const manifestPath = path.join(packagePath, "package.json");
    const resolvedManifestPath = await realpath(manifestPath);
    if (!(await isPathContained(packagePath, resolvedManifestPath))) {
      throw new Error("package.json resolves outside the package directory");
    }
    const manifestStat = await stat(resolvedManifestPath);
    if (!manifestStat.isFile() || manifestStat.size > MAX_MANIFEST_FILE_SIZE) {
      throw new Error("package.json is not a regular file or exceeds the size limit");
    }
    source = await readFile(resolvedManifestPath, "utf8");
  } catch (error) {
    const missing = isFileNotFound(error);
    warnings.push({
      code: missing ? "MANIFEST_MISSING" : "MANIFEST_INVALID",
      message: missing
        ? `package.json is missing for ${packageLabel(reference)}.`
        : `package.json could not be read for ${packageLabel(reference)}.`,
    });
    return null;
  }

  try {
    const manifest: unknown = JSON.parse(source);
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new TypeError("The package manifest must be an object");
    }
    return manifest as Record<string, unknown>;
  } catch {
    warnings.push({
      code: "MANIFEST_INVALID",
      message: `package.json contains invalid JSON for ${packageLabel(reference)}.`,
    });
    return null;
  }
}

function manifestMatchesReference(
  manifest: Record<string, unknown>,
  reference: PackageReference,
): boolean {
  return manifest.name === reference.name && manifest.version === reference.version;
}

function readDeclaration(manifest: Record<string, unknown>): ManifestDeclaration {
  const hasLicense = Object.hasOwn(manifest, "license");
  const primary = hasLicense ? readDeclarationValue(manifest.license) : null;
  const hasLegacyLicenses = Object.hasOwn(manifest, "licenses");
  const legacy = hasLegacyLicenses
    ? readLegacyDeclarations(manifest.licenses)
    : { invalid: false, raw: null };
  const normalizedPrimary = primary === null ? null : normalizeSpdx(primary);
  const primaryExpression =
    normalizedPrimary ?? (hasLicense ? "LicenseRef-Unknown-License-Declaration" : null);
  const normalizedLegacy = legacy.raw;
  const invalid = (hasLicense && normalizedPrimary === null) || legacy.invalid;

  if (primaryExpression !== null && normalizedLegacy !== null) {
    if (primaryExpression === normalizedLegacy) {
      return { conflict: false, invalid, raw: primaryExpression };
    }
    return {
      conflict: true,
      invalid,
      raw: `(${primaryExpression}) AND (${normalizedLegacy})`,
    };
  }

  return {
    conflict: false,
    invalid,
    raw: primaryExpression ?? normalizedLegacy,
  };
}

function readDeclarationValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim().length === 0 ? null : value;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const type = (value as Record<string, unknown>).type;
  return typeof type === "string" && type.trim().length > 0 ? type : null;
}

function readLegacyDeclarations(value: unknown): LegacyDeclaration {
  if (!Array.isArray(value) || value.length === 0) {
    return { invalid: true, raw: null };
  }

  const declarations = new Set<string>();
  let invalid = false;
  for (const valueEntry of value) {
    const declaration = readDeclarationValue(valueEntry);
    const normalized = declaration === null ? null : normalizeSpdx(declaration);
    if (normalized === null) {
      invalid = true;
      continue;
    }
    declarations.add(normalized);
  }

  if (invalid) {
    declarations.add("LicenseRef-Unknown-License-Declaration");
  }

  const combined = [...declarations].map((declaration) => `(${declaration})`).join(" OR ");
  const normalized = combined.length === 0 ? null : normalizeSpdx(combined);

  return {
    invalid: invalid || normalized === null,
    raw: normalized ?? (declarations.size === 0 ? null : "LicenseRef-Unknown-License-Declaration"),
  };
}

async function detectLicenseFile(packagePath: string): Promise<FileDetection> {
  let entries: Dirent[];
  try {
    entries = await readdir(packagePath, { withFileTypes: true });
  } catch {
    return {
      ambiguous: true,
      license: "LicenseRef-Unknown-License-Evidence",
      strictExpression: false,
    };
  }

  const candidates = entries
    .filter(
      (entry) =>
        (entry.isFile() || entry.isSymbolicLink()) &&
        /^(?:licen[cs]e|copying)(?:$|[._-])/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort(compareLicenseFileNames);

  const detected = new Set<string>();
  let ambiguous = false;
  let strictExpression = false;
  for (const candidate of candidates) {
    const filePath = path.join(packagePath, candidate);
    try {
      const resolvedFilePath = await realpath(filePath);
      if (!(await isPathContained(packagePath, resolvedFilePath))) {
        ambiguous = true;
        continue;
      }
      const fileStat = await stat(resolvedFilePath);
      if (!fileStat.isFile() || fileStat.size > MAX_LICENSE_FILE_SIZE) {
        ambiguous = true;
        continue;
      }
      const evidence = detectLicenseEvidenceFromText(await readFile(resolvedFilePath, "utf8"));
      if (evidence.license !== null) {
        detected.add(evidence.license);
        strictExpression ||= evidence.explicitCompound;
      } else {
        ambiguous = true;
      }
    } catch {
      ambiguous = true;
    }
  }

  if (detected.size > 1) ambiguous = true;
  if (ambiguous) detected.add("LicenseRef-Unknown-License-Evidence");
  return {
    ambiguous,
    license: combineFileEvidence(detected),
    strictExpression,
  };
}

function combineFileEvidence(detected: ReadonlySet<string>): string | null {
  const licenses = [...detected].sort();
  if (licenses.length === 0) return null;
  if (licenses.length === 1) return licenses[0] ?? null;
  return (
    normalizeSpdx(licenses.map((license) => `(${license})`).join(" AND ")) ??
    "LicenseRef-Unknown-License-Evidence"
  );
}

interface LicenseTerm {
  base: string;
  exception?: string;
  expression: string;
}

function findSupplementalDetectedLicenses(
  declaredLicense: string,
  detectedLicense: string,
  strictExpression = false,
): readonly string[] {
  const declared = parseSpdxExpression(declaredLicense);
  const detected = parseSpdxExpression(detectedLicense);
  if (declared === null || detected === null) {
    return [detectedLicense];
  }

  const declaredTerms = collectLicenseTerms(declared);
  const detectedTerms = collectLicenseTerms(detected);
  if (strictExpression && detectedTerms.length > 1 && declaredLicense !== detectedLicense) {
    return [detectedLicense];
  }

  const supplemental = new Set<string>();
  for (const term of detectedTerms) {
    const covered = declaredTerms.some(
      (declaredTerm) =>
        declaredTerm.base === term.base &&
        (declaredTerm.exception === undefined || declaredTerm.exception === term.exception),
    );
    if (!covered) {
      supplemental.add(term.expression);
    }
  }
  return [...supplemental].sort();
}

function collectLicenseTerms(expression: SpdxExpression): readonly LicenseTerm[] {
  if ("conjunction" in expression) {
    return [...collectLicenseTerms(expression.left), ...collectLicenseTerms(expression.right)];
  }
  const base = formatSpdxExpression({
    license: expression.license,
    ...(expression.plus === true ? { plus: true as const } : {}),
  });
  return [
    {
      base,
      ...(expression.exception === undefined ? {} : { exception: expression.exception }),
      expression: formatSpdxExpression(expression),
    },
  ];
}

function compareLicenseFileNames(left: string, right: string): number {
  const priorityDifference = licenseFilePriority(left) - licenseFilePriority(right);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

function licenseFilePriority(fileName: string): number {
  const normalized = fileName.toLowerCase();
  if (normalized === "license") {
    return 0;
  }
  if (normalized === "licence") {
    return 1;
  }
  if (normalized === "copying") {
    return 2;
  }
  return normalized.startsWith("license") ? 3 : normalized.startsWith("licence") ? 4 : 5;
}

function resolvePackagePath(projectPath: string, referencePath: string): string | null {
  if (
    referencePath.includes("\0") ||
    path.isAbsolute(referencePath) ||
    path.posix.isAbsolute(referencePath) ||
    path.win32.isAbsolute(referencePath) ||
    /^[a-z]:/i.test(referencePath)
  ) {
    return null;
  }

  const segments = referencePath.split(/[\\/]+/).filter((segment) => segment !== "");
  if (segments.some((segment) => segment === "..")) {
    return null;
  }

  const root = path.resolve(projectPath);
  const packagePath = path.resolve(root, ...segments);
  const relative = path.relative(root, packagePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")
    ? packagePath
    : null;
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function isPathContained(root: string, candidate: string): Promise<boolean> {
  try {
    const [resolvedRoot, resolvedCandidate] = await Promise.all([
      realpath(root),
      realpath(candidate),
    ]);
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    return (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  } catch {
    return false;
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function packageLabel(reference: PackageReference): string {
  return `${reference.name}@${reference.version}`;
}
