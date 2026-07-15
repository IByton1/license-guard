import type { PolicyConfig, PolicyConfigInput } from "./config/types.js";
import type { ResolvedPackage } from "./lockfile/types.js";

export type PolicyStatus = "allowed" | "denied" | "ignored" | "warning";

export interface PolicyEvaluation {
  reason: string;
  status: PolicyStatus;
}

export interface AnalyzedPackage extends ResolvedPackage {
  policy: PolicyEvaluation;
}

export interface AnalysisWarning {
  code: string;
  message: string;
  package?: string;
  path?: string;
}

export interface LicenseCount {
  count: number;
  license: string;
}

export interface AnalysisSummary {
  allowed: number;
  denied: number;
  ignored: number;
  licenses: readonly LicenseCount[];
  packages: number;
  unknown: number;
  warnings: number;
}

export interface AnalysisResult {
  compliant: boolean;
  lockfilePath: string;
  lockfileVersion: 2 | 3;
  packages: readonly AnalyzedPackage[];
  policy: PolicyConfig;
  production: boolean;
  projectPath: string;
  schemaVersion: "1";
  summary: AnalysisSummary;
  warnings: readonly AnalysisWarning[];
}

export interface AnalyzeOptions {
  config?: PolicyConfigInput;
  configPath?: string;
  production?: boolean;
  projectPath?: string;
}
