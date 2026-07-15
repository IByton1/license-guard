import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { createProject, removeProject } from "./helpers/project.js";

const projects: string[] = [];

afterEach(async () => {
  await Promise.all(projects.splice(0).map(removeProject));
});

describe("analyze", () => {
  it("runs the complete pipeline in deterministic order", async () => {
    const projectPath = await createProject([
      { license: "GPL-3.0", name: "blocked", version: "2.0.0" },
      { license: "MIT", name: "allowed", version: "1.0.0" },
    ]);
    projects.push(projectPath);

    const result = await analyze({
      config: {
        allow: ["MIT"],
        deny: ["GPL-3.0-only"],
      },
      projectPath,
    });

    expect(result.compliant).toBe(false);
    expect(result.packages.map(({ name }) => name)).toEqual(["allowed", "blocked"]);
    expect(result.summary).toMatchObject({ allowed: 1, denied: 1, packages: 2 });
    expect(result.packages[1]?.finalLicense).toBe("GPL-3.0-only");
  });

  it("lets the explicit production option override config", async () => {
    const projectPath = await createProject([
      { dev: true, license: "GPL-3.0", name: "dev-only", version: "1.0.0" },
      { license: "MIT", name: "runtime", version: "1.0.0" },
    ]);
    projects.push(projectPath);

    const result = await analyze({
      config: {
        allow: ["MIT"],
        deny: ["GPL-3.0-only"],
        production: false,
      },
      production: true,
      projectPath,
    });

    expect(result.compliant).toBe(true);
    expect(result.packages.map(({ name }) => name)).toEqual(["runtime"]);
  });

  it("rejects simultaneous object and file configuration", async () => {
    await expect(
      analyze({ config: {}, configPath: "policy.json", projectPath: "." }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
  });

  it("skips optional packages that npm did not install on the current platform", async () => {
    const projectPath = await createProject([
      {
        installed: false,
        license: "MIT",
        name: "other-platform-binary",
        optional: true,
        version: "1.0.0",
      },
    ]);
    projects.push(projectPath);

    const result = await analyze({ config: {}, projectPath });

    expect(result.compliant).toBe(true);
    expect(result.packages).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "PACKAGE_MISSING", package: "other-platform-binary@1.0.0" }),
    ]);
  });

  it("does not skip a missing required package with a forged optional marker", async () => {
    const projectPath = await createProject([
      {
        installed: false,
        license: "MIT",
        name: "required-package",
        version: "1.0.0",
      },
    ]);
    projects.push(projectPath);
    const lockfilePath = join(projectPath, "package-lock.json");
    const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
    lockfile.packages["node_modules/required-package"].optional = true;
    await writeFile(lockfilePath, `${JSON.stringify(lockfile)}\n`);

    const result = await analyze({ config: {}, projectPath });

    expect(result.packages).toEqual([
      expect.objectContaining({
        finalLicense: "UNKNOWN",
        name: "required-package",
        optional: false,
      }),
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "PACKAGE_MISSING", package: "required-package@1.0.0" }),
    ]);
  });

  it("does not skip a missing required peer dependency", async () => {
    const projectPath = await createProject([
      { license: "MIT", name: "parent", version: "1.0.0" },
      {
        installed: false,
        license: "GPL-3.0-only",
        name: "required-peer",
        version: "1.0.0",
      },
    ]);
    projects.push(projectPath);
    const lockfilePath = join(projectPath, "package-lock.json");
    const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
    delete lockfile.packages[""].dependencies["required-peer"];
    lockfile.packages["node_modules/parent"].peerDependencies = {
      "required-peer": "1.0.0",
    };
    await writeFile(lockfilePath, `${JSON.stringify(lockfile)}\n`);

    const result = await analyze({ config: {}, projectPath });

    expect(result.compliant).toBe(false);
    expect(result.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          finalLicense: "UNKNOWN",
          name: "required-peer",
          optional: false,
        }),
      ]),
    );
  });
});
