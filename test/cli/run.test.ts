import { access, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CliIo, runCli } from "../../src/cli/run.js";
import { createProject, removeProject } from "../helpers/project.js";

const projects: string[] = [];

afterEach(async () => {
  await Promise.all(projects.splice(0).map(removeProject));
});

function capture(cwd: string): { io: CliIo; stderr: string[]; stdout: string[] } {
  const stderr: string[] = [];
  const stdout: string[] = [];
  return {
    io: {
      color: false,
      cwd,
      stderr: (value) => stderr.push(value),
      stdout: (value) => stdout.push(value),
    },
    stderr,
    stdout,
  };
}

describe("runCli", () => {
  it("returns JSON on stdout and the policy exit code", async () => {
    const project = await createProject([
      { license: "GPL-3.0", name: "blocked", version: "1.0.0" },
    ]);
    projects.push(project);
    const streams = capture(project);
    await runCli(["init"], streams.io);
    streams.stdout.length = 0;

    const exitCode = await runCli(["--json"], streams.io);

    expect(exitCode).toBe(1);
    expect(streams.stderr).toEqual([]);
    expect(JSON.parse(streams.stdout.join(""))).toMatchObject({
      compliant: false,
      schemaVersion: "1",
    });
  });

  it("does not overwrite config without force", async () => {
    const project = await createProject([]);
    projects.push(project);
    const streams = capture(project);

    expect(await runCli(["init"], streams.io)).toBe(0);
    expect(await runCli(["init"], streams.io)).toBe(2);
    await expect(access(join(project, ".licenseguardrc.json"))).resolves.toBeUndefined();
  });

  it("writes reports to an output path", async () => {
    const project = await createProject([{ license: "MIT", name: "safe", version: "1.0.0" }]);
    projects.push(project);
    const streams = capture(project);

    const exitCode = await runCli(["--json", "--output", "reports/licenses.json"], streams.io);
    const report = JSON.parse(await readFile(join(project, "reports/licenses.json"), "utf8"));

    expect(exitCode).toBe(0);
    expect(report.schemaVersion).toBe("1");
    expect(streams.stdout).toEqual([]);
  });

  it("does not write terminal color codes to report files", async () => {
    const project = await createProject([{ license: "MIT", name: "safe", version: "1.0.0" }]);
    projects.push(project);
    const streams = capture(project);
    streams.io.color = true;

    expect(await runCli(["--output", "report.txt"], streams.io)).toBe(0);
    expect(await readFile(join(project, "report.txt"), "utf8")).not.toContain("\u001B[");
  });

  it("does not follow an output symlink", async () => {
    const project = await createProject([]);
    projects.push(project);
    const target = join(project, "target.txt");
    await writeFile(target, "keep\n");
    await symlink(target, join(project, "report.json"), "file");
    const streams = capture(project);

    expect(await runCli(["--json", "--output", "report.json"], streams.io)).toBe(2);
    expect(await readFile(target, "utf8")).toBe("keep\n");
  });

  it("does not create directories through a parent symlink outside the project", async () => {
    const project = await createProject([]);
    const outside = await createProject([]);
    projects.push(project, outside);
    await symlink(
      outside,
      join(project, "reports"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const streams = capture(project);

    expect(
      await runCli(["--json", "--output", "reports/new/nested/licenses.json"], streams.io),
    ).toBe(2);
    await expect(access(join(outside, "new"))).rejects.toThrow();
  });

  it("does not follow a config symlink when init uses force", async () => {
    const project = await createProject([]);
    projects.push(project);
    const target = join(project, "target.json");
    await writeFile(target, "keep\n");
    await symlink(target, join(project, ".licenseguardrc.json"), "file");
    const streams = capture(project);

    expect(await runCli(["init", "--force"], streams.io)).toBe(2);
    expect(await readFile(target, "utf8")).toBe("keep\n");
  });

  it.each(["--production", "--summary"])("rejects %s with init", async (option) => {
    const project = await createProject([]);
    projects.push(project);
    const streams = capture(project);

    expect(await runCli(["init", option], streams.io)).toBe(2);
    await expect(access(join(project, ".licenseguardrc.json"))).rejects.toThrow();
  });

  it("shows help without reading the project", async () => {
    const streams = capture("/path/that/does/not/exist");
    expect(await runCli(["--help"], streams.io)).toBe(0);
    expect(streams.stdout.join("")).toContain("Exit codes:");
  });

  it("escapes control characters in diagnostics", async () => {
    const project = await createProject([]);
    projects.push(project);
    await writeFile(
      join(project, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {}, "node_modules/bad\u001b[2J": { version: "1.0.0" } },
      }),
    );
    const streams = capture(project);

    expect(await runCli([], streams.io)).toBe(2);
    expect(streams.stderr.join("")).not.toContain("\u001B");
    expect(streams.stderr.join("")).toContain("\\u001b");
  });
});
