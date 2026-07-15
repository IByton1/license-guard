import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { errorMessage, LicenseGuardError } from "../errors.js";
import { normalizeSpdx, parseSpdxExpression } from "../license/spdx.js";
import {
  defaultPolicyConfig,
  type OverrideAction,
  type PolicyBehavior,
  type PolicyConfig,
} from "./types.js";

const CONFIG_FILE_NAME = ".licenseguardrc.json";
const MAX_CONFIG_FILE_SIZE = 1024 * 1024;
const CONFIG_FIELDS = new Set([
  "allow",
  "deny",
  "overrides",
  "production",
  "unknownLicense",
  "unlistedLicense",
]);
const POLICY_BEHAVIORS = new Set<PolicyBehavior>(["allow", "error", "warn"]);
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
const VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function invalid(message: string, cause?: unknown): LicenseGuardError {
  return new LicenseGuardError("CONFIG_INVALID", message, cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

function validateBehavior(value: unknown, field: string): PolicyBehavior {
  if (typeof value !== "string" || !POLICY_BEHAVIORS.has(value as PolicyBehavior)) {
    throw invalid(`"${field}" must be one of "allow", "error", or "warn".`);
  }

  return value as PolicyBehavior;
}

function validateLicenseList(value: unknown, field: "allow" | "deny"): readonly string[] {
  if (!Array.isArray(value)) {
    throw invalid(`"${field}" must be an array of SPDX license identifiers.`);
  }

  const licenses = value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw invalid(`"${field}[${index}]" must be a non-empty SPDX license identifier.`);
    }

    const expression = parseSpdxExpression(entry);
    if (expression === null) {
      const suggestion = normalizeSpdx(entry);
      const hint = suggestion === null ? "" : ` Did you mean "${suggestion}"?`;
      throw invalid(`Invalid SPDX license "${entry}" in "${field}".${hint}`);
    }

    if ("conjunction" in expression) {
      throw invalid(
        `"${field}[${index}]" must contain one SPDX license, not an AND/OR expression.`,
      );
    }

    const normalized = normalizeSpdx(entry);
    if (normalized === null) {
      throw invalid(`Invalid SPDX license "${entry}" in "${field}".`);
    }
    if (normalized !== entry) {
      throw invalid(
        `Non-canonical SPDX license "${entry}" in "${field}". Did you mean "${normalized}"?`,
      );
    }

    return normalized;
  });

  return Object.freeze(licenses);
}

function splitOverrideKey(key: string): { name: string; version?: string } | null {
  if (key.length === 0) {
    return null;
  }

  const separator = key.lastIndexOf("@");
  const hasVersion = key.startsWith("@") ? separator > key.indexOf("/") : separator > 0;
  if (!hasVersion) {
    return PACKAGE_NAME_PATTERN.test(key) ? { name: key } : null;
  }

  const name = key.slice(0, separator);
  const version = key.slice(separator + 1);
  if (!PACKAGE_NAME_PATTERN.test(name) || !VERSION_PATTERN.test(version)) {
    return null;
  }

  return { name, version };
}

function validateOverrides(value: unknown): Readonly<Record<string, OverrideAction>> {
  if (!isRecord(value)) {
    throw invalid('"overrides" must be an object whose values are "ignore".');
  }

  const entries = Object.entries(value).map(([key, action]) => {
    if (splitOverrideKey(key) === null) {
      throw invalid(
        `Invalid override key "${key}". Expected a package name or an exact name@version.`,
      );
    }

    if (action !== "ignore") {
      throw invalid(`Override "${key}" must use the action "ignore".`);
    }

    return [key, action] as const;
  });

  return Object.freeze(Object.fromEntries(entries));
}

function licenseFamily(license: string): string {
  return license.replace(/-(?:only|or-later)$/, "");
}

function policyLicensesOverlap(left: string, right: string): boolean {
  const leftExpression = parseSpdxExpression(left);
  const rightExpression = parseSpdxExpression(right);
  if (
    leftExpression === null ||
    rightExpression === null ||
    "conjunction" in leftExpression ||
    "conjunction" in rightExpression ||
    leftExpression.exception !== rightExpression.exception
  ) {
    return false;
  }

  if (leftExpression.license === rightExpression.license) return true;
  return (
    licenseFamily(leftExpression.license) === licenseFamily(rightExpression.license) &&
    (leftExpression.license.endsWith("-or-later") || rightExpression.license.endsWith("-or-later"))
  );
}

export function validatePolicyConfig(input: unknown): PolicyConfig {
  if (!isRecord(input)) {
    throw invalid("The policy config must be a JSON object.");
  }

  const unknownFields = Object.keys(input).filter((field) => !CONFIG_FIELDS.has(field));
  if (unknownFields.length > 0) {
    unknownFields.sort();
    throw invalid(
      `Unknown policy field${unknownFields.length === 1 ? "" : "s"}: ${unknownFields.join(", ")}.`,
    );
  }

  const allow = hasOwn(input, "allow")
    ? validateLicenseList(input.allow, "allow")
    : defaultPolicyConfig.allow;
  const deny = hasOwn(input, "deny")
    ? validateLicenseList(input.deny, "deny")
    : defaultPolicyConfig.deny;
  const overrides = hasOwn(input, "overrides")
    ? validateOverrides(input.overrides)
    : defaultPolicyConfig.overrides;

  const production = hasOwn(input, "production")
    ? input.production
    : defaultPolicyConfig.production;
  if (typeof production !== "boolean") {
    throw invalid('"production" must be a boolean.');
  }

  const unknownLicense = hasOwn(input, "unknownLicense")
    ? validateBehavior(input.unknownLicense, "unknownLicense")
    : defaultPolicyConfig.unknownLicense;
  const unlistedLicense = hasOwn(input, "unlistedLicense")
    ? validateBehavior(input.unlistedLicense, "unlistedLicense")
    : defaultPolicyConfig.unlistedLicense;

  const conflicts = [
    ...new Set(
      allow.filter((allowed) => deny.some((denied) => policyLicensesOverlap(allowed, denied))),
    ),
  ].sort();
  if (conflicts.length > 0) {
    throw new LicenseGuardError(
      "CONFIG_CONFLICT",
      `License${conflicts.length === 1 ? "" : "s"} present in both "allow" and "deny": ${conflicts.join(", ")}.`,
    );
  }

  return Object.freeze({
    allow,
    deny,
    overrides,
    production,
    unknownLicense,
    unlistedLicense,
  });
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export async function loadPolicyConfig(
  projectPath: string,
  configPath?: string,
): Promise<PolicyConfig> {
  const explicitPath = configPath !== undefined;
  const absoluteProjectPath = resolve(projectPath);
  const resolvedConfigPath =
    configPath !== undefined
      ? isAbsolute(configPath)
        ? configPath
        : resolve(absoluteProjectPath, configPath)
      : join(absoluteProjectPath, CONFIG_FILE_NAME);

  let source: string;
  try {
    const resolvedFilePath = await realpath(resolvedConfigPath);
    if (!explicitPath) {
      const projectDirectory = await realpath(absoluteProjectPath);
      const pathFromProject = relative(projectDirectory, resolvedFilePath);
      if (
        pathFromProject === ".." ||
        pathFromProject.startsWith(`..${sep}`) ||
        isAbsolute(pathFromProject)
      ) {
        throw invalid(`Policy config resolves outside the project: ${resolvedConfigPath}`);
      }
    }
    const metadata = await stat(resolvedFilePath);
    if (!metadata.isFile()) {
      throw invalid(`Policy config is not a regular file: ${resolvedConfigPath}`);
    }
    if (metadata.size > MAX_CONFIG_FILE_SIZE) {
      throw invalid(`Policy config exceeds the 1 MiB size limit: ${resolvedConfigPath}`);
    }
    source = await readFile(resolvedFilePath, "utf8");
  } catch (error) {
    if (error instanceof LicenseGuardError) throw error;
    if (isFileNotFound(error)) {
      if (!explicitPath) {
        return validatePolicyConfig({});
      }

      throw new LicenseGuardError(
        "CONFIG_NOT_FOUND",
        `Policy config not found: ${resolvedConfigPath}`,
        error,
      );
    }

    throw invalid(
      `Could not read policy config ${resolvedConfigPath}: ${errorMessage(error)}`,
      error,
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(source) as unknown;
  } catch (error) {
    throw invalid(
      `Policy config is not valid JSON (${resolvedConfigPath}): ${errorMessage(error)}`,
      error,
    );
  }

  return validatePolicyConfig(input);
}
