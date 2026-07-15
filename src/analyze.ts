import { resolve } from "node:path";
import { loadPolicyConfig, validatePolicyConfig } from "./config/loader.js";
import { LicenseGuardError } from "./errors.js";
import { extractPackageLicense } from "./license/extractor.js";
import { parseNpmLockfile } from "./lockfile/npm.js";
import type { PackageReference, ResolvedPackage } from "./lockfile/types.js";
import { evaluatePackage } from "./policy/engine.js";
import type {
  AnalysisResult,
  AnalysisSummary,
  AnalysisWarning,
  AnalyzedPackage,
  AnalyzeOptions,
  LicenseCount,
} from "./types.js";
import { compareText } from "./utils/sort.js";

const EXTRACTION_CONCURRENCY = 32;

async function mapConcurrent<T, U>(
  values: readonly T[],
  concurrency: number,
  transform: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value !== undefined) {
        results[index] = await transform(value);
      }
    }
  }

  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function packageOrder(left: AnalyzedPackage, right: AnalyzedPackage): number {
  return (
    compareText(left.name, right.name) ||
    compareText(left.version, right.version) ||
    compareText(left.path, right.path)
  );
}

function createSummary(packages: readonly AnalyzedPackage[]): AnalysisSummary {
  const licenseCounts = new Map<string, number>();
  let allowed = 0;
  let denied = 0;
  let ignored = 0;
  let warnings = 0;
  let unknown = 0;

  for (const pkg of packages) {
    licenseCounts.set(pkg.finalLicense, (licenseCounts.get(pkg.finalLicense) ?? 0) + 1);
    if (pkg.finalLicense === "UNKNOWN" || pkg.finalLicense.includes("LicenseRef-")) {
      unknown += 1;
    }

    switch (pkg.policy.status) {
      case "allowed":
        allowed += 1;
        break;
      case "denied":
        denied += 1;
        break;
      case "ignored":
        ignored += 1;
        break;
      case "warning":
        warnings += 1;
        break;
    }
  }

  const licenses: LicenseCount[] = [...licenseCounts]
    .sort(([left], [right]) => compareText(left, right))
    .map(([license, count]) => ({ count, license }));

  return {
    allowed,
    denied,
    ignored,
    licenses,
    packages: packages.length,
    unknown,
    warnings,
  };
}

function collectWarnings(packages: readonly ResolvedPackage[]): AnalysisWarning[] {
  return packages
    .flatMap((pkg) =>
      pkg.warnings.map((warning) => ({
        code: warning.code,
        message: warning.message,
        package: `${pkg.name}@${pkg.version}`,
        path: pkg.path,
      })),
    )
    .sort(
      (left, right) =>
        compareText(left.package ?? "", right.package ?? "") ||
        compareText(left.path ?? "", right.path ?? "") ||
        compareText(left.code, right.code),
    );
}

function isUninstalledOptionalPackage(pkg: ResolvedPackage): boolean {
  return pkg.optional && pkg.warnings.some((warning) => warning.code === "PACKAGE_MISSING");
}

async function resolvePackage(
  projectPath: string,
  reference: PackageReference,
): Promise<ResolvedPackage> {
  return extractPackageLicense(projectPath, reference);
}

export async function analyze(options: AnalyzeOptions = {}): Promise<AnalysisResult> {
  if (options.config !== undefined && options.configPath !== undefined) {
    throw new LicenseGuardError("CONFIG_CONFLICT", "Use either config or configPath, not both.");
  }

  const projectPath = resolve(options.projectPath ?? process.cwd());
  const policy =
    options.config === undefined
      ? await loadPolicyConfig(projectPath, options.configPath)
      : validatePolicyConfig(options.config);
  const production = options.production ?? policy.production;
  const lockfile = await parseNpmLockfile(projectPath, { production });
  const resolvedPackages = await mapConcurrent(
    lockfile.packages,
    EXTRACTION_CONCURRENCY,
    (reference) => resolvePackage(projectPath, reference),
  );
  const packages = resolvedPackages
    .filter((pkg) => !isUninstalledOptionalPackage(pkg))
    .map(
      (pkg): AnalyzedPackage => ({
        ...pkg,
        policy: evaluatePackage(pkg, policy),
      }),
    )
    .sort(packageOrder);
  const summary = createSummary(packages);

  return {
    compliant: summary.denied === 0,
    lockfilePath: lockfile.lockfilePath,
    lockfileVersion: lockfile.lockfileVersion,
    packages,
    policy,
    production,
    projectPath,
    schemaVersion: "1",
    summary,
    warnings: collectWarnings(resolvedPackages),
  };
}
