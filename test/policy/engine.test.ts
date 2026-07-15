import { describe, expect, it } from "vitest";

import { validatePolicyConfig } from "../../src/config/loader.js";
import type { PolicyConfigInput } from "../../src/config/types.js";
import type { ResolvedPackage } from "../../src/lockfile/types.js";
import { evaluatePackage } from "../../src/policy/engine.js";

function policy(input: PolicyConfigInput = {}) {
  return validatePolicyConfig(input);
}

function resolvedPackage(
  finalLicense: string,
  options: Partial<Pick<ResolvedPackage, "name" | "version">> = {},
): ResolvedPackage {
  return {
    declaredLicense: finalLicense === "UNKNOWN" ? null : finalLicense,
    detectedLicense: null,
    dev: false,
    finalLicense,
    licenseSource: finalLicense === "UNKNOWN" ? "unknown" : "declared",
    name: options.name ?? "dependency",
    optional: false,
    path: "node_modules/dependency",
    version: options.version ?? "1.0.0",
    warnings: [],
  };
}

describe("evaluatePackage", () => {
  it("applies explicit allow and deny rules", () => {
    const config = policy({
      allow: ["MIT"],
      deny: ["GPL-3.0-only"],
      unlistedLicense: "error",
    });

    expect(evaluatePackage(resolvedPackage("MIT"), config).status).toBe("allowed");
    expect(evaluatePackage(resolvedPackage("GPL-3.0-only"), config).status).toBe("denied");
  });

  it.each([
    ["allow", "allowed"],
    ["warn", "warning"],
    ["error", "denied"],
  ] as const)("maps unlistedLicense=%s to %s", (behavior, status) => {
    const evaluation = evaluatePackage(
      resolvedPackage("Apache-2.0"),
      policy({ allow: ["MIT"], unlistedLicense: behavior }),
    );

    expect(evaluation.status).toBe(status);
    expect(evaluation.reason).toContain(`unlistedLicense="${behavior}"`);
  });

  it.each([
    ["allow", "allowed"],
    ["warn", "warning"],
    ["error", "denied"],
  ] as const)("maps UNKNOWN with unknownLicense=%s to %s", (behavior, status) => {
    const evaluation = evaluatePackage(
      resolvedPackage("UNKNOWN"),
      policy({ unknownLicense: behavior }),
    );

    expect(evaluation.status).toBe(status);
    expect(evaluation.reason).toContain(`unknownLicense="${behavior}"`);
  });

  it("treats an invalid final license as unknown", () => {
    const evaluation = evaluatePackage(
      resolvedPackage("invalid license"),
      policy({ unknownLicense: "warn" }),
    );

    expect(evaluation).toMatchObject({ status: "warning" });
    expect(evaluation.reason).toContain("not a valid SPDX expression");
  });

  it("treats an unlisted custom LicenseRef as unknown", () => {
    const evaluation = evaluatePackage(
      resolvedPackage("LicenseRef-Proprietary"),
      policy({ unknownLicense: "error", unlistedLicense: "allow" }),
    );

    expect(evaluation.status).toBe("denied");
    expect(evaluation.reason).toContain('unknownLicense="error"');
  });

  it("does not let a plus suffix bypass a denied base license", () => {
    const evaluation = evaluatePackage(
      resolvedPackage("MIT+"),
      policy({ deny: ["MIT"], unlistedLicense: "warn" }),
    );

    expect(evaluation.status).toBe("denied");
    expect(evaluation.reason).toContain("includes denied base license");
  });

  it("applies a naked base denial to an unlisted plus expression with an exception", () => {
    const evaluation = evaluatePackage(
      resolvedPackage("EPL-1.0+ WITH LLVM-exception"),
      policy({ deny: ["EPL-1.0"], unlistedLicense: "warn" }),
    );

    expect(evaluation.status).toBe("denied");
    expect(evaluation.reason).toContain('denied base license "EPL-1.0"');
  });

  it.each([
    ["GPL-3.0-or-later", "GPL-3.0-only"],
    ["GPL-3.0-only", "GPL-3.0-or-later"],
  ])("applies overlapping GNU-family denials from %s to %s", (license, denied) => {
    const evaluation = evaluatePackage(
      resolvedPackage(license),
      policy({ deny: [denied], unlistedLicense: "warn" }),
    );

    expect(evaluation.status).toBe("denied");
    expect(evaluation.reason).toContain("overlaps denied license family rule");
  });

  it("allows a custom LicenseRef only when it is explicitly listed", () => {
    const evaluation = evaluatePackage(
      resolvedPackage("LicenseRef-Approved-Internal"),
      policy({ allow: ["LicenseRef-Approved-Internal"], unknownLicense: "error" }),
    );

    expect(evaluation.status).toBe("allowed");
  });

  it("makes a package override visible and prefers an exact version override", () => {
    const evaluation = evaluatePackage(
      resolvedPackage("GPL-3.0-only", { name: "dependency", version: "2.0.0" }),
      policy({
        deny: ["GPL-3.0-only"],
        overrides: {
          dependency: "ignore",
          "dependency@2.0.0": "ignore",
        },
      }),
    );

    expect(evaluation).toEqual({
      status: "ignored",
      reason: 'Ignored by policy override "dependency@2.0.0".',
    });
  });

  it("supports scoped package overrides", () => {
    const evaluation = evaluatePackage(
      resolvedPackage("GPL-3.0-only", { name: "@scope/dependency" }),
      policy({ overrides: { "@scope/dependency": "ignore" } }),
    );

    expect(evaluation.status).toBe("ignored");
  });

  describe("SPDX conjunctions", () => {
    it("allows OR when at least one alternative is allowed", () => {
      const evaluation = evaluatePackage(
        resolvedPackage("GPL-3.0-only OR MIT"),
        policy({ allow: ["MIT"], deny: ["GPL-3.0-only"], unlistedLicense: "error" }),
      );

      expect(evaluation.status).toBe("allowed");
      expect(evaluation.reason).toContain("at least one OR alternative");
    });

    it("warns for OR when no alternative is allowed but one requires review", () => {
      const evaluation = evaluatePackage(
        resolvedPackage("GPL-3.0-only OR Apache-2.0"),
        policy({ deny: ["GPL-3.0-only"], unlistedLicense: "warn" }),
      );

      expect(evaluation.status).toBe("warning");
    });

    it("denies OR when every alternative is denied", () => {
      const evaluation = evaluatePackage(
        resolvedPackage("GPL-3.0-only OR AGPL-3.0-only"),
        policy({ deny: ["GPL-3.0-only", "AGPL-3.0-only"] }),
      );

      expect(evaluation.status).toBe("denied");
    });

    it("allows AND only when every requirement is allowed", () => {
      const evaluation = evaluatePackage(
        resolvedPackage("MIT AND Apache-2.0"),
        policy({ allow: ["MIT", "Apache-2.0"] }),
      );

      expect(evaluation.status).toBe("allowed");
      expect(evaluation.reason).toContain("every AND requirement is allowed");
    });

    it("denies AND when any requirement is denied", () => {
      const evaluation = evaluatePackage(
        resolvedPackage("MIT AND GPL-3.0-only"),
        policy({ allow: ["MIT"], deny: ["GPL-3.0-only"] }),
      );

      expect(evaluation.status).toBe("denied");
    });

    it("warns for AND when no requirement is denied but one requires review", () => {
      const evaluation = evaluatePackage(
        resolvedPackage("MIT AND Apache-2.0"),
        policy({ allow: ["MIT"], unlistedLicense: "warn" }),
      );

      expect(evaluation.status).toBe("warning");
    });

    it("evaluates nested conjunctions recursively", () => {
      const evaluation = evaluatePackage(
        resolvedPackage("(GPL-3.0-only OR MIT) AND Apache-2.0"),
        policy({
          allow: ["MIT", "Apache-2.0"],
          deny: ["GPL-3.0-only"],
          unlistedLicense: "error",
        }),
      );

      expect(evaluation.status).toBe("allowed");
    });
  });

  describe("SPDX exceptions", () => {
    const expression = "GPL-2.0-only WITH Classpath-exception-2.0";

    it("uses an exception-specific rule before the base license", () => {
      const evaluation = evaluatePackage(
        resolvedPackage(expression),
        policy({ allow: [expression], deny: ["GPL-2.0-only"] }),
      );

      expect(evaluation.status).toBe("allowed");
    });

    it("can deny an exception-specific expression while allowing the base license", () => {
      const evaluation = evaluatePackage(
        resolvedPackage(expression),
        policy({ allow: ["GPL-2.0-only"], deny: [expression] }),
      );

      expect(evaluation.status).toBe("denied");
    });

    it("falls back to the base license when no exception-specific rule exists", () => {
      const evaluation = evaluatePackage(
        resolvedPackage(expression),
        policy({ allow: ["GPL-2.0-only"] }),
      );

      expect(evaluation.status).toBe("allowed");
      expect(evaluation.reason).toContain("has no exception-specific rule");
    });
  });
});
