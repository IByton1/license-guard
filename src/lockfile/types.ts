export interface PackageReference {
  dev: boolean;
  name: string;
  optional: boolean;
  path: string;
  version: string;
}

export interface LockfileResult {
  lockfilePath: string;
  lockfileVersion: 2 | 3;
  packages: readonly PackageReference[];
}

export type LicenseSource = "combined" | "declared" | "detected" | "unknown";

export interface PackageWarning {
  code:
    | "DECLARED_LICENSE_INVALID"
    | "DECLARED_LICENSE_CONFLICT"
    | "LICENSE_EVIDENCE_AMBIGUOUS"
    | "LICENSE_MISMATCH"
    | "MANIFEST_INVALID"
    | "MANIFEST_MISMATCH"
    | "MANIFEST_MISSING"
    | "PACKAGE_OUTSIDE_PROJECT"
    | "PACKAGE_MISSING";
  message: string;
}

export interface ResolvedPackage extends PackageReference {
  declaredLicense: string | null;
  detectedLicense: string | null;
  finalLicense: string;
  licenseSource: LicenseSource;
  warnings: readonly PackageWarning[];
}
