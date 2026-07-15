import type { AnalysisResult, PolicyStatus } from "../types.js";
import { LEGAL_NOTICE } from "./constants.js";
import type { ReportOptions } from "./json.js";

function escapeHtml(value: boolean | number | string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function statusClass(status: PolicyStatus): string {
  return status === "allowed" ? "ok" : status === "denied" ? "error" : "warning";
}

function renderPackageRows(result: AnalysisResult): string {
  return result.packages
    .map(
      (pkg) => `<tr>
<td>${escapeHtml(pkg.name)}</td>
<td>${escapeHtml(pkg.version)}</td>
<td><code>${escapeHtml(pkg.finalLicense)}</code></td>
<td class="${statusClass(pkg.policy.status)}">${escapeHtml(pkg.policy.status)}</td>
<td>${escapeHtml(pkg.licenseSource)}</td>
<td><code>${escapeHtml(pkg.path)}</code></td>
</tr>`,
    )
    .join("\n");
}

function renderLicenseRows(result: AnalysisResult): string {
  return result.summary.licenses
    .map(
      ({ count, license }) =>
        `<tr><td><code>${escapeHtml(license)}</code></td><td>${escapeHtml(count)}</td></tr>`,
    )
    .join("\n");
}

function renderWarnings(result: AnalysisResult): string {
  if (result.warnings.length === 0) return "";
  const items = result.warnings
    .map(
      (warning) =>
        `<li><strong>${escapeHtml(warning.package ?? warning.path ?? warning.code)}</strong>: ${escapeHtml(warning.message)}</li>`,
    )
    .join("\n");
  return `<h2>Detection warnings</h2><ul>${items}</ul>`;
}

export function renderHtml(result: AnalysisResult, options: ReportOptions = {}): string {
  const status = result.compliant ? "Compliant" : "Policy violations found";
  const details = options.summaryOnly
    ? `<h2>Licenses</h2><table><thead><tr><th>License</th><th>Count</th></tr></thead><tbody>${renderLicenseRows(result)}</tbody></table>`
    : `<h2>Packages</h2><table><thead><tr><th>Package</th><th>Version</th><th>License</th><th>Status</th><th>Source</th><th>Path</th></tr></thead><tbody>${renderPackageRows(result)}</tbody></table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>license-guard report</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{max-width:1200px;margin:2rem auto;padding:0 1rem}h1,h2{line-height:1.2}.summary{display:flex;flex-wrap:wrap;gap:1rem;margin:1.5rem 0}.metric{border:1px solid #8886;border-radius:.5rem;padding:.75rem 1rem}.metric strong{display:block;font-size:1.5rem}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{border-bottom:1px solid #8886;padding:.6rem;text-align:left;vertical-align:top}th{position:sticky;top:0;background:Canvas}.ok{color:#16803c}.warning{color:#a15c00}.error{color:#c32626}code{overflow-wrap:anywhere}.disclaimer{margin-top:2rem;color:#777;font-size:.85rem}
</style>
</head>
<body>
<h1>license-guard report</h1>
<p class="${result.compliant ? "ok" : "error"}"><strong>${status}</strong></p>
<div class="summary">
<div class="metric"><strong>${result.summary.packages}</strong>Packages</div>
<div class="metric"><strong>${result.summary.allowed}</strong>Allowed</div>
<div class="metric"><strong>${result.summary.warnings}</strong>Warnings</div>
<div class="metric"><strong>${result.summary.denied}</strong>Denied</div>
<div class="metric"><strong>${result.summary.unknown}</strong>Unknown</div>
<div class="metric"><strong>${result.summary.ignored}</strong>Overrides</div>
</div>
${details}
${renderWarnings(result)}
<p class="disclaimer">${escapeHtml(LEGAL_NOTICE)}</p>
</body>
</html>
`;
}
