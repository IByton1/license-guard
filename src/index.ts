export { analyze } from "./analyze.js";
export type {
  OverrideAction,
  PolicyBehavior,
  PolicyConfig,
  PolicyConfigInput,
} from "./config/types.js";
export type { LicenseGuardErrorCode } from "./errors.js";
export { LicenseGuardError } from "./errors.js";
export { normalizeSpdx } from "./license/spdx.js";
export type { LicenseSource, PackageWarning } from "./lockfile/types.js";
export type {
  AnalysisResult,
  AnalysisSummary,
  AnalysisWarning,
  AnalyzedPackage,
  AnalyzeOptions,
  LicenseCount,
  PolicyEvaluation,
  PolicyStatus,
} from "./types.js";
