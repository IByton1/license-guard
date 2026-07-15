import pc from "picocolors";
import type { AnalysisResult, PolicyStatus } from "../types.js";
import { LEGAL_NOTICE } from "./constants.js";

export interface TerminalReportOptions {
  color?: boolean;
  summaryOnly?: boolean;
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 3))}...`;
}

function statusColor(
  colors: ReturnType<typeof pc.createColors>,
  status: PolicyStatus,
  value: string,
): string {
  if (status === "allowed") return colors.green(value);
  if (status === "denied") return colors.red(value);
  if (status === "ignored") return colors.cyan(value);
  return colors.yellow(value);
}

function renderSummary(result: AnalysisResult): string[] {
  const width = Math.max(
    "LICENSE".length,
    ...result.summary.licenses.map(({ license }) => license.length),
  );
  const lines = [`${"LICENSE".padEnd(width)}  COUNT`, `${"-".repeat(width)}  -----`];
  for (const entry of result.summary.licenses) {
    lines.push(`${entry.license.padEnd(width)}  ${entry.count}`);
  }
  return lines;
}

function renderPackages(
  result: AnalysisResult,
  colors: ReturnType<typeof pc.createColors>,
): string[] {
  const rows = result.packages.map((pkg) => [
    truncate(pkg.name, 36),
    truncate(pkg.version, 18),
    truncate(pkg.finalLicense, 36),
    pkg.policy.status.toUpperCase(),
    truncate(pkg.path, 52),
  ]);
  const headers = ["PACKAGE", "VERSION", "LICENSE", "STATUS", "PATH"];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const line = (cells: readonly string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ");
  const output = [colors.bold(line(headers)), line(widths.map((width) => "-".repeat(width)))];

  rows.forEach((row, index) => {
    const pkg = result.packages[index];
    if (pkg === undefined) return;
    const raw = line(row);
    const statusStart = widths.slice(0, 3).reduce((total, width) => total + width + 2, 0);
    const statusWidth = widths[3] ?? 0;
    output.push(
      `${raw.slice(0, statusStart)}${statusColor(colors, pkg.policy.status, raw.slice(statusStart, statusStart + statusWidth))}${raw.slice(statusStart + statusWidth)}`,
    );
  });
  return output;
}

export function renderTerminal(
  result: AnalysisResult,
  options: TerminalReportOptions = {},
): string {
  const colors = pc.createColors(options.color ?? false);
  const lines = options.summaryOnly ? renderSummary(result) : renderPackages(result, colors);
  const summary = result.summary;
  lines.push("");
  lines.push(
    `Packages: ${summary.packages} | Allowed: ${summary.allowed} | Warnings: ${summary.warnings} | Denied: ${summary.denied} | Unknown: ${summary.unknown} | Overrides: ${summary.ignored}`,
  );
  lines.push(
    result.compliant
      ? colors.green(colors.bold("Policy check passed."))
      : colors.red(colors.bold("Policy check failed.")),
  );

  if (result.warnings.length > 0) {
    lines.push("", colors.yellow(colors.bold("Detection warnings:")));
    for (const warning of result.warnings) {
      lines.push(`- ${warning.package ?? warning.path ?? warning.code}: ${warning.message}`);
    }
  }

  lines.push("", colors.dim(LEGAL_NOTICE));
  return `${lines.join("\n")}\n`;
}
