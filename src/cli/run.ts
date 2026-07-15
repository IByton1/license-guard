import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import { analyze } from "../analyze.js";
import { initializeConfig } from "../config/init.js";
import { errorMessage, LicenseGuardError } from "../errors.js";
import { renderCsv, renderHtml, renderJson, renderTerminal } from "../report/index.js";
import { writeTextFile } from "../utils/write.js";
import { VERSION } from "../version.js";

export interface CliIo {
  color: boolean;
  cwd: string;
  stderr: (value: string) => void;
  stdout: (value: string) => void;
}

const HELP = `license-guard ${VERSION}

Offline license compliance checks for npm dependency trees.

Usage:
  license-guard [options]
  license-guard init [--force] [--config <path>]

Options:
  --config <path>   Config file (default: .licenseguardrc.json)
  --cwd <path>      Project directory (default: current directory)
  --production      Exclude dev dependencies
  --summary         Show aggregate license counts
  --json            Emit JSON
  --csv             Emit CSV
  --html            Emit standalone HTML
  --output <path>   Write the report to a file
  --no-color        Disable terminal colors
  --help, -h        Show help
  --version, -v     Show version

Exit codes:
  0  Policy check passed
  1  Policy violation found
  2  Usage, configuration, or analysis error
`;

const options = {
  config: { type: "string" as const },
  csv: { type: "boolean" as const },
  cwd: { type: "string" as const },
  force: { type: "boolean" as const },
  help: { type: "boolean" as const, short: "h" },
  html: { type: "boolean" as const },
  json: { type: "boolean" as const },
  "no-color": { type: "boolean" as const },
  output: { type: "string" as const },
  production: { type: "boolean" as const },
  summary: { type: "boolean" as const },
  version: { type: "boolean" as const, short: "v" },
};

function defaultIo(): CliIo {
  return {
    color: Boolean(process.stdout.isTTY),
    cwd: process.cwd(),
    stderr: (value) => process.stderr.write(value),
    stdout: (value) => process.stdout.write(value),
  };
}

async function writeOutput(path: string, content: string, containmentRoot?: string): Promise<void> {
  try {
    await writeTextFile(path, content, {
      ...(containmentRoot === undefined ? {} : { containmentRoot }),
      overwrite: true,
    });
  } catch (error) {
    throw new LicenseGuardError(
      "OUTPUT_WRITE_FAILED",
      `Could not write report to ${path}: ${errorMessage(error)}`,
      error,
    );
  }
}

function renderReport(
  format: "csv" | "html" | "json" | "terminal",
  result: Awaited<ReturnType<typeof analyze>>,
  summaryOnly: boolean,
  color: boolean,
): string {
  if (format === "json") return renderJson(result, { summaryOnly });
  if (format === "csv") return renderCsv(result, { summaryOnly });
  if (format === "html") return renderHtml(result, { summaryOnly });
  return renderTerminal(result, { color, summaryOnly });
}

export async function runCli(args: readonly string[], io: CliIo = defaultIo()): Promise<number> {
  try {
    const parsed = parseArgs({
      allowPositionals: true,
      args: [...args],
      options,
      strict: true,
      tokens: false,
    });

    if (parsed.values.help) {
      io.stdout(HELP);
      return 0;
    }
    if (parsed.values.version) {
      io.stdout(`${VERSION}\n`);
      return 0;
    }

    const projectPath = resolve(io.cwd, parsed.values.cwd ?? ".");
    const command = parsed.positionals[0];
    if (parsed.positionals.length > 1 || (command !== undefined && command !== "init")) {
      throw new LicenseGuardError("USAGE_ERROR", `Unknown command: ${command ?? ""}`);
    }

    if (command === "init") {
      if (
        parsed.values.csv ||
        parsed.values.html ||
        parsed.values.json ||
        parsed.values["no-color"] ||
        parsed.values.output ||
        parsed.values.production ||
        parsed.values.summary
      ) {
        throw new LicenseGuardError(
          "USAGE_ERROR",
          "Analysis and report options cannot be used with init.",
        );
      }
      const destination = await initializeConfig(
        projectPath,
        parsed.values.config,
        parsed.values.force,
      );
      io.stdout(`Created ${destination}\n`);
      return 0;
    }

    if (parsed.values.force) {
      throw new LicenseGuardError("USAGE_ERROR", "--force can only be used with init.");
    }
    const formats = [parsed.values.json, parsed.values.csv, parsed.values.html].filter(Boolean);
    if (formats.length > 1) {
      throw new LicenseGuardError("USAGE_ERROR", "Use only one of --json, --csv, or --html.");
    }
    const format = parsed.values.json
      ? "json"
      : parsed.values.csv
        ? "csv"
        : parsed.values.html
          ? "html"
          : "terminal";
    const result = await analyze({
      ...(parsed.values.config === undefined ? {} : { configPath: parsed.values.config }),
      ...(parsed.values.production === undefined ? {} : { production: parsed.values.production }),
      projectPath,
    });
    const content = renderReport(
      format,
      result,
      parsed.values.summary ?? false,
      io.color && !parsed.values["no-color"] && parsed.values.output === undefined,
    );

    if (parsed.values.output) {
      const outputPath = isAbsolute(parsed.values.output)
        ? parsed.values.output
        : resolve(projectPath, parsed.values.output);
      await writeOutput(
        outputPath,
        content,
        isAbsolute(parsed.values.output) ? undefined : projectPath,
      );
    } else {
      io.stdout(content);
    }
    return result.compliant ? 0 : 1;
  } catch (error) {
    io.stderr(`license-guard: ${errorMessage(error)}\n`);
    if (!(error instanceof LicenseGuardError)) {
      io.stderr("Run license-guard --help for usage.\n");
    }
    return 2;
  }
}
