import { basename, relative, sep } from "node:path";
import type { AnalysisResult } from "../types.js";
import { LEGAL_NOTICE } from "./constants.js";

export interface ReportOptions {
  summaryOnly?: boolean;
}

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

export function createJsonReport(result: AnalysisResult, options: ReportOptions = {}): object {
  const report = {
    schemaVersion: result.schemaVersion,
    project: basename(result.projectPath),
    lockfile: portablePath(relative(result.projectPath, result.lockfilePath)),
    lockfileVersion: result.lockfileVersion,
    production: result.production,
    compliant: result.compliant,
    legalNotice: LEGAL_NOTICE,
    summary: result.summary,
    warnings: result.warnings,
  };

  if (options.summaryOnly) return report;

  return {
    ...report,
    packages: result.packages.map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      path: pkg.path,
      dev: pkg.dev,
      optional: pkg.optional,
      declaredLicense: pkg.declaredLicense,
      detectedLicense: pkg.detectedLicense,
      license: pkg.finalLicense,
      licenseSource: pkg.licenseSource,
      status: pkg.policy.status,
      reason: pkg.policy.reason,
      warnings: pkg.warnings,
    })),
  };
}

export function renderJson(result: AnalysisResult, options: ReportOptions = {}): string {
  return `${JSON.stringify(createJsonReport(result, options), null, 2)}\n`;
}
