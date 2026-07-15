import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyze } from "../../src/analyze.js";
import { renderCsv } from "../../src/report/csv.js";
import { renderHtml } from "../../src/report/html.js";
import { renderJson } from "../../src/report/json.js";
import { renderTerminal } from "../../src/report/terminal.js";
import type { AnalysisResult } from "../../src/types.js";
import { createProject, removeProject } from "../helpers/project.js";

let projectPath: string;
let result: AnalysisResult;

beforeAll(async () => {
  projectPath = await createProject([
    { license: "MIT", name: "a,package", version: "1.0.0" },
    { license: "GPL-3.0-only", name: "blocked", version: "2.0.0" },
  ]);
  result = await analyze({
    config: { allow: ["MIT"], deny: ["GPL-3.0-only"] },
    projectPath,
  });
});

afterAll(async () => {
  await removeProject(projectPath);
});

describe("reporters", () => {
  it("emits a versioned full and summary JSON report", () => {
    const full = JSON.parse(renderJson(result)) as Record<string, unknown>;
    const summary = JSON.parse(renderJson(result, { summaryOnly: true })) as Record<
      string,
      unknown
    >;

    expect(full.schemaVersion).toBe("1");
    expect(full.legalNotice).toContain("not legal advice");
    expect(full.packages).toHaveLength(2);
    expect(summary).not.toHaveProperty("packages");
  });

  it("quotes CSV fields and supports aggregate output", () => {
    expect(renderCsv(result)).toContain('"a,package"');
    expect(renderCsv(result)).toContain("not legal advice");
    expect(renderCsv(result, { summaryOnly: true })).toContain("recordType,license,count");
  });

  it("preserves scoped package names while neutralizing spreadsheet formulas", () => {
    const scopedResult: AnalysisResult = {
      ...result,
      packages: result.packages.slice(0, 1).map((pkg) => ({ ...pkg, name: "@scope/package" })),
      warnings: [{ code: "FORMULA", message: '=HYPERLINK("https://example.test")' }],
    };
    const csv = renderCsv(scopedResult);

    expect(csv).toContain("package,@scope/package,");
    expect(csv).not.toContain("'@scope/package");
    expect(csv).toContain("'=HYPERLINK");
  });

  it("escapes standalone HTML and includes the legal notice", () => {
    const html = renderHtml(result);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("not legal advice");
    expect(html).not.toContain("<script");
  });

  it("renders deterministic plain terminal output", () => {
    const output = renderTerminal(result, { color: false });
    expect(output).toContain("Policy check failed.");
    expect(output).not.toContain("\u001B[");
  });
});
