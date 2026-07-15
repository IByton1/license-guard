import type { AnalysisResult } from "../types.js";
import { LEGAL_NOTICE } from "./constants.js";
import type { ReportOptions } from "./json.js";

function csvCell(value: boolean | number | string): string {
  const formula =
    typeof value === "string" &&
    (/^[=+-]/.test(value) || (/^@/.test(value) && !isScopedPackageName(value)));
  const text = formula ? `'${value}` : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function isScopedPackageName(value: string): boolean {
  return /^@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*$/i.test(value);
}

function csvRow(values: readonly (boolean | number | string)[]): string {
  return values.map(csvCell).join(",");
}

function renderSummaryCsv(result: AnalysisResult): string {
  const rows = [
    csvRow([
      "recordType",
      "license",
      "count",
      "warningCode",
      "warningPackage",
      "warningPath",
      "warningMessage",
      "legalNotice",
    ]),
  ];
  for (const entry of result.summary.licenses) {
    rows.push(csvRow(["license", entry.license, entry.count, "", "", "", "", LEGAL_NOTICE]));
  }
  for (const warning of result.warnings) {
    rows.push(
      csvRow([
        "warning",
        "",
        "",
        warning.code,
        warning.package ?? "",
        warning.path ?? "",
        warning.message,
        LEGAL_NOTICE,
      ]),
    );
  }
  return `${rows.join("\n")}\n`;
}

export function renderCsv(result: AnalysisResult, options: ReportOptions = {}): string {
  if (options.summaryOnly) return renderSummaryCsv(result);

  const rows = [
    csvRow([
      "recordType",
      "name",
      "version",
      "license",
      "status",
      "source",
      "dev",
      "optional",
      "path",
      "reason",
      "warningCode",
      "warningMessage",
      "legalNotice",
    ]),
  ];
  for (const pkg of result.packages) {
    rows.push(
      csvRow([
        "package",
        pkg.name,
        pkg.version,
        pkg.finalLicense,
        pkg.policy.status,
        pkg.licenseSource,
        pkg.dev,
        pkg.optional,
        pkg.path,
        pkg.policy.reason,
        "",
        "",
        LEGAL_NOTICE,
      ]),
    );
  }
  for (const warning of result.warnings) {
    rows.push(
      csvRow([
        "warning",
        warning.package ?? "",
        "",
        "",
        "",
        "",
        "",
        "",
        warning.path ?? "",
        "",
        warning.code,
        warning.message,
        LEGAL_NOTICE,
      ]),
    );
  }
  return `${rows.join("\n")}\n`;
}
