import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), "license-guard-pack-"));
const packed = join(temporary, "packed");
const consumer = join(temporary, "consumer");
const npmExecPath = process.env.npm_execpath;
if (npmExecPath === undefined) throw new Error("Run this check through npm run test:pack");

const expectedFiles = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "dist/cli.cjs",
  "dist/cli.cjs.map",
  "dist/cli.d.cts",
  "dist/cli.d.ts",
  "dist/cli.js",
  "dist/cli.js.map",
  "dist/index.cjs",
  "dist/index.cjs.map",
  "dist/index.d.cts",
  "dist/index.d.ts",
  "dist/index.js",
  "dist/index.js.map",
  "package.json",
];

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });
}

function runNpm(args, cwd) {
  return run(process.execPath, [npmExecPath, ...args], cwd);
}

function runInstalledBin(args, cwd) {
  const executable = join(
    cwd,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "license-guard.cmd" : "license-guard",
  );
  if (!existsSync(executable)) throw new Error("npm did not create the license-guard bin shim");
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : executable;
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", `"${executable}" ${args.join(" ")}`] : args;
  return execFileSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
}

try {
  mkdirSync(packed);
  mkdirSync(consumer);
  const packOutput = runNpm(["pack", "--silent", "--json", "--pack-destination", packed], root);
  const jsonOffset = packOutput.lastIndexOf("\n[");
  const packResult = JSON.parse(
    jsonOffset === -1 ? packOutput : packOutput.slice(jsonOffset + 1),
  )[0];
  const actualFiles = packResult.files.map(({ path }) => path).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Unexpected tarball contents:\n${actualFiles.join("\n")}`);
  }
  const cliEntry = packResult.files.find(({ path }) => path === "dist/cli.js");
  if (cliEntry === undefined || (cliEntry.mode & 0o111) === 0) {
    throw new Error("dist/cli.js is not executable in the tarball");
  }
  const archive = readdirSync(packed).find((file) => file.endsWith(".tgz"));
  if (archive === undefined) throw new Error("npm pack did not create a tarball");

  writeFileSync(join(consumer, "package.json"), '{"name":"consumer","private":true}\n');
  runNpm(
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--registry=https://registry.npmjs.org",
      join(packed, archive),
    ],
    consumer,
  );

  writeFileSync(
    join(consumer, "esm.mjs"),
    'import { normalizeSpdx } from "license-guard"; if (normalizeSpdx("Apache 2") !== "Apache-2.0") process.exit(1);\n',
  );
  writeFileSync(
    join(consumer, "cjs.cjs"),
    'const { normalizeSpdx } = require("license-guard"); if (normalizeSpdx("MIT") !== "MIT") process.exit(1);\n',
  );
  writeFileSync(
    join(consumer, "esm.mts"),
    'import { normalizeSpdx } from "license-guard"; const license: string | null = normalizeSpdx("MIT");\n',
  );
  writeFileSync(
    join(consumer, "cjs.cts"),
    'import { normalizeSpdx } from "license-guard"; const license: string | null = normalizeSpdx("MIT");\n',
  );
  writeFileSync(
    join(consumer, "tsconfig.json"),
    '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","noEmit":true,"strict":true,"target":"ES2022"},"include":["*.mts","*.cts"]}\n',
  );
  run(process.execPath, ["esm.mjs"], consumer);
  run(process.execPath, ["cjs.cjs"], consumer);
  run(
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    consumer,
  );
  const installedPackage = JSON.parse(
    readFileSync(join(consumer, "node_modules/license-guard/package.json"), "utf8"),
  );
  if (installedPackage.bin?.["license-guard"] !== "dist/cli.js") {
    throw new Error("Installed package has an invalid license-guard bin mapping");
  }
  if (!runInstalledBin(["--help"], consumer).includes("Offline license compliance")) {
    throw new Error("Installed bin shim did not render CLI help");
  }
  if (runInstalledBin(["--version"], consumer).trim() !== installedPackage.version) {
    throw new Error("Installed CLI version does not match its package version");
  }
  const report = JSON.parse(runInstalledBin(["--production", "--json"], consumer));
  if (report.schemaVersion !== "1" || report.compliant !== true) {
    throw new Error("Installed CLI did not produce a compliant schemaVersion 1 report");
  }
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
