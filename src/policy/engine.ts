import type { PolicyBehavior, PolicyConfig } from "../config/types.js";
import {
  formatSpdxExpression,
  parseSpdxExpression,
  type SpdxConjunctionNode,
  type SpdxExpression,
  type SpdxLicenseNode,
} from "../license/spdx.js";
import type { ResolvedPackage } from "../lockfile/types.js";
import type { PolicyEvaluation, PolicyStatus } from "../types.js";

type LicenseStatus = Exclude<PolicyStatus, "ignored">;

interface LicenseEvaluation {
  reason: string;
  status: LicenseStatus;
}

interface PolicySets {
  allow: ReadonlySet<string>;
  deny: ReadonlySet<string>;
}

function statusForBehavior(behavior: PolicyBehavior): LicenseStatus {
  switch (behavior) {
    case "allow":
      return "allowed";
    case "warn":
      return "warning";
    case "error":
      return "denied";
  }
}

function evaluateByBehavior(
  subject: string,
  setting: "unknownLicense" | "unlistedLicense",
  behavior: PolicyBehavior,
): LicenseEvaluation {
  return {
    status: statusForBehavior(behavior),
    reason: `${subject} follows ${setting}="${behavior}".`,
  };
}

function formatLicense(node: SpdxLicenseNode, includeException = true): string {
  const base = `${node.license}${node.plus === true ? "+" : ""}`;
  return includeException && node.exception !== undefined ? `${base} WITH ${node.exception}` : base;
}

function isCustomLicenseReference(license: string): boolean {
  return license.startsWith("LicenseRef-") || license.includes(":LicenseRef-");
}

function explicitEvaluation(license: string, sets: PolicySets): LicenseEvaluation | null {
  if (sets.deny.has(license)) {
    return {
      status: "denied",
      reason: `"${license}" is explicitly denied.`,
    };
  }

  if (sets.allow.has(license)) {
    return {
      status: "allowed",
      reason: `"${license}" is explicitly allowed.`,
    };
  }

  return null;
}

function familyCounterpart(license: string): string | null {
  if (license.endsWith("-only")) {
    return `${license.slice(0, -"-only".length)}-or-later`;
  }
  if (license.endsWith("-or-later")) {
    return `${license.slice(0, -"-or-later".length)}-only`;
  }
  return null;
}

function deniedFamilyEvaluation(
  license: SpdxLicenseNode,
  sets: PolicySets,
  includeException: boolean,
): LicenseEvaluation | null {
  const counterpart = familyCounterpart(license.license);
  if (counterpart === null) return null;
  const expression = formatLicense({
    license: counterpart,
    ...(includeException && license.exception !== undefined
      ? { exception: license.exception }
      : {}),
  });
  if (!sets.deny.has(expression)) return null;
  return {
    status: "denied",
    reason: `"${formatLicense(license)}" overlaps denied license family rule "${expression}".`,
  };
}

function evaluateLicense(
  license: SpdxLicenseNode,
  config: PolicyConfig,
  sets: PolicySets,
): LicenseEvaluation {
  const exactLicense = formatLicense(license);
  const exact = explicitEvaluation(exactLicense, sets);
  if (exact !== null) {
    return exact;
  }

  const family = deniedFamilyEvaluation(license, sets, true);
  if (family !== null) return family;

  if (license.plus === true) {
    const withoutPlus = formatLicense({
      license: license.license,
      ...(license.exception === undefined ? {} : { exception: license.exception }),
    });
    const includedLicenses = new Set([withoutPlus, license.license]);
    for (const includedLicense of includedLicenses) {
      const base = explicitEvaluation(includedLicense, sets);
      if (base?.status === "denied") {
        return {
          status: "denied",
          reason: `"${exactLicense}" includes denied base license "${includedLicense}": ${base.reason}`,
        };
      }
    }
  }

  if (license.exception !== undefined) {
    const baseLicense = formatLicense(license, false);
    const base = explicitEvaluation(baseLicense, sets);
    if (base !== null) {
      return {
        status: base.status,
        reason: `"${exactLicense}" has no exception-specific rule and follows "${baseLicense}": ${base.reason}`,
      };
    }
    const baseFamily = deniedFamilyEvaluation(license, sets, false);
    if (baseFamily !== null) return baseFamily;
  }

  if (isCustomLicenseReference(license.license)) {
    return evaluateByBehavior(
      `Custom license reference "${exactLicense}" has no explicit policy rule and`,
      "unknownLicense",
      config.unknownLicense,
    );
  }

  return evaluateByBehavior(
    `"${exactLicense}" is not listed and`,
    "unlistedLicense",
    config.unlistedLicense,
  );
}

function evaluateOr(
  expression: SpdxConjunctionNode,
  left: LicenseEvaluation,
  right: LicenseEvaluation,
): LicenseEvaluation {
  const formatted = formatSpdxExpression(expression);
  const allowed = left.status === "allowed" ? left : right.status === "allowed" ? right : null;
  if (allowed !== null) {
    return {
      status: "allowed",
      reason: `${formatted} is allowed because at least one OR alternative is allowed: ${allowed.reason}`,
    };
  }

  const warning = left.status === "warning" ? left : right.status === "warning" ? right : null;
  if (warning !== null) {
    return {
      status: "warning",
      reason: `${formatted} needs review because no OR alternative is explicitly allowed: ${warning.reason}`,
    };
  }

  return {
    status: "denied",
    reason: `${formatted} is denied because every OR alternative is denied: ${left.reason} ${right.reason}`,
  };
}

function evaluateAnd(
  expression: SpdxConjunctionNode,
  left: LicenseEvaluation,
  right: LicenseEvaluation,
): LicenseEvaluation {
  const formatted = formatSpdxExpression(expression);
  const denied = left.status === "denied" ? left : right.status === "denied" ? right : null;
  if (denied !== null) {
    return {
      status: "denied",
      reason: `${formatted} is denied because every AND requirement must be allowed: ${denied.reason}`,
    };
  }

  const warning = left.status === "warning" ? left : right.status === "warning" ? right : null;
  if (warning !== null) {
    return {
      status: "warning",
      reason: `${formatted} needs review because every AND requirement must be allowed: ${warning.reason}`,
    };
  }

  return {
    status: "allowed",
    reason: `${formatted} is allowed because every AND requirement is allowed.`,
  };
}

function evaluateExpression(
  expression: SpdxExpression,
  config: PolicyConfig,
  sets: PolicySets,
): LicenseEvaluation {
  if (!("conjunction" in expression)) {
    return evaluateLicense(expression, config, sets);
  }

  const left = evaluateExpression(expression.left, config, sets);
  const right = evaluateExpression(expression.right, config, sets);
  return expression.conjunction === "or"
    ? evaluateOr(expression, left, right)
    : evaluateAnd(expression, left, right);
}

function matchingOverride(pkg: ResolvedPackage, config: PolicyConfig): string | null {
  const exactKey = `${pkg.name}@${pkg.version}`;
  if (Object.hasOwn(config.overrides, exactKey) && config.overrides[exactKey] === "ignore") {
    return exactKey;
  }

  if (Object.hasOwn(config.overrides, pkg.name) && config.overrides[pkg.name] === "ignore") {
    return pkg.name;
  }

  return null;
}

export function evaluatePackage(pkg: ResolvedPackage, config: PolicyConfig): PolicyEvaluation {
  const override = matchingOverride(pkg, config);
  if (override !== null) {
    return {
      status: "ignored",
      reason: `Ignored by policy override "${override}".`,
    };
  }

  if (pkg.finalLicense === "UNKNOWN") {
    return evaluateByBehavior('License is "UNKNOWN" and', "unknownLicense", config.unknownLicense);
  }

  const expression = parseSpdxExpression(pkg.finalLicense);
  if (expression === null) {
    return evaluateByBehavior(
      `License "${pkg.finalLicense}" is not a valid SPDX expression and`,
      "unknownLicense",
      config.unknownLicense,
    );
  }

  return evaluateExpression(expression, config, {
    allow: new Set(config.allow),
    deny: new Set(config.deny),
  });
}
